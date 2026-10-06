# versioncam

Record demo clips of a real web app: scripted, deterministic, re-recorded on
every push.

A clip is a script in your repository. It drives your app through its own
controls in a real browser and captures what the page shows. Then it draws a
cursor and a camera over the frames and encodes a video. Record it again on
every push. When the app changes under a clip, the clip *fails*: it names the
control it could not find and the second it gave up. It never turns into a
video that is quietly wrong.

## Install

Three commands, then one sentence to your agent:

```bash
npm i -D versioncam
npx versioncam install       # the Chromium this version records with
npx versioncam init          # the authoring skill, into .claude/
```

```
/versioncam "Show a user filtering the list down to one shipment"
```

The first run of the skill sets the repository up. It writes
`versioncam.config.ts` from what it finds, proves the app starts and records
the same way twice, and only then writes the clip. See *Authoring*.

In a monorepo, run all three in the app's own directory. The skill goes
there, and so does the config its first run writes.

`npx versioncam doctor` checks the rest: Node 22 or later, Chromium, ffmpeg,
your config and the scenes module it names, if any, and whether the app
starts. ffmpeg and ffprobe come from the
system (`brew install ffmpeg`, `apt install ffmpeg`). The optional
`ffmpeg-static` package covers a machine that has neither, but it has no
ffprobe. versioncam is tested on macOS and Linux. Windows is untested.

Use `versioncam install`, not `npx playwright install`. versioncam pins its
Playwright exactly, because a new Chromium changes every captured pixel. Your
app may have a Playwright of its own at another version, and
`npx playwright install` fetches that one's Chromium.

### In CI

The same install, then `check`. It records every clip and fails the job on the
first one that no longer matches the app.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
- run: npx versioncam install --with-deps
- run: npx versioncam check
```

`check` records and does not render, so it needs no ffmpeg. A job that also
runs `render` adds `sudo apt-get install -y ffmpeg`.

Two runs on one runner image produce the same bytes. To pin everything the
pixels depend on (the browser build, the fonts, the system libraries), run the
job in the Playwright image for the version versioncam pins,
`mcr.microsoft.com/playwright:v1.59.1-noble`. Chromium and its libraries are
already installed there.

## Configure

`versioncam.config.ts` sits beside your clips. It is the one place your app
describes itself to the recorder.

```ts
import { defineRecorder } from "versioncam";

export default defineRecorder({
  baseUrl: process.env.DEMOS_BASE_URL ?? "http://localhost:5173",
  viewport: { width: 1440, height: 900 },
  clips: "demos/clips/**/*.clip.ts",

  // How to start the app when nothing is serving it.
  webServer: { command: "npm run dev" },

  // Either a saved browser session…
  auth: { storageState: ".versioncam/auth.json" },
  // …or a hook, if signing in needs steps.
  // auth: { login: async (page) => { … } },

  // What "the page is done" means beyond a quiet DOM and an idle network.
  settle: {
    ready: async (page) => page.evaluate(() => window.__map?.loaded() ?? true),
  },
});
```

If the recorder needs to know something about your app that this object
cannot say, that is a missing field. It is not a reason to fork.

| Field | Default | What it sets |
|---|---|---|
| `baseUrl` | required | Where the app is served. |
| `webServer` | none | How to start the app when nothing is serving it. See *Starting the app*. |
| `clips` | `"demos/**/*.clip.ts"` | Where the clips are: a glob, or a list of them, relative to the config. |
| `viewport` | `{ width: 1440, height: 900 }` | The page's size. The video has the same shape. |
| `dpr` | `2` | Device pixel ratio, from 1 to 3. At 2, a zoom shows real pixels. |
| `fps` | `60` | Frames per second, from 10 to 120. |
| `output` | `{ width: 1920 }` | The video's width. Its height follows the viewport. `threads` fixes how many threads each encoder uses: an encoder's bytes depend on it, so a fixed number renders the same recording to the same file on any machine. `VERSIONCAM_FFMPEG_THREADS` sets it for one run. |
| `auth` | none | How the app signs in: a saved session, `{ storageState }`, or a hook, `{ login }`. |
| `settle` | `quietMs: 150`, `timeoutMs: 15000`, `yieldMs: 20` | When a page counts as done. `ready` adds a condition of your own. |
| `capture` | `gate: true`, `forceCaptureEvery: 30`, `transitions: "play"` | Which frames get a screenshot (see *Speed*), and whether the app's CSS transitions play on its clock or take no time, `"zero"` (see *Determinism*). |
| `review` | `minSeconds: 9`, `maxSeconds: 11` | How long a clip should run. `versioncam review` holds clips to it. |
| `cursorStart` | `{ x: 0.72, y: 0.28 }` | Where the cursor rests in the first frame, as fractions of the viewport. |
| `clock` | `time: "2026-09-01T09:00:00Z"`, `timezoneId: "UTC"`, `locale: "en-GB"` | The instant, time zone and locale the app sees. |
| `theme` | `accent: "#2f6fed"`, `cursorScale: 2.1` | The colour of ripples and rings, the cursor's size, and an optional `presentation`. See *Presentation*. |
| `motion` | `MOTION` | Dwells, strokes and camera timing. `MOTION` is exported, with the reason for each number beside it. |
| `outDir` | `".versioncam"` | Where everything the recorder writes goes. Gitignore it. |
| `scenes` | none | A module whose default export is `Record<string, Scene>`, keyed by scene id: `export default { [intro.id]: intro }`. A named export is not read, and a module with no default export is refused. |
| `sequence` | none | Clip ids, in order, for `versioncam render --sequence`. |

### Starting the app

`webServer` is Playwright's, field for field:

| Field | Default | What it sets |
|---|---|---|
| `command` | required | Run through a shell to start the app. |
| `url` | `baseUrl` | What to ask whether the app is up. |
| `cwd` | the config's directory | Where `command` runs. |
| `timeoutMs` | `120000` | How long to wait for `url` to answer. |
| `reuseExistingServer` | `true`, and `false` when `CI` is set | Use a server that already answers instead of starting one. |
| `env` | `{}` | Added to the shell's environment, for the server only. |

Every command that drives the app (`record`, `check`, `stability`, `inspect`,
`measure`, `login` and `doctor`) goes through the same steps:

1. It asks `url` whether anything is serving. Any answer counts, a 401
   included.
2. If something answers, it uses that server as it is and leaves it running.
   With `CI` set it refuses instead: on a runner, a server that was up before
   the job started is not the build under test. `reuseExistingServer: true`
   allows it.
3. If nothing answers, it runs `command` with the shell's environment plus
   `env`. It does not pass on what the recorder loaded from `.env.recording`
   for itself. It waits for `url` to answer and writes the server's output to
   `.versioncam/webserver.log`.
4. When it finishes, normally, on an error or on Ctrl-C, it stops what it
   started. It signals the command's whole process group: SIGTERM, then
   SIGKILL after five seconds. The log says which one it took.

A process the start command hands off to outside its group, such as a
container runtime, is out of reach. The command warns when the port still
answers after the stop. Start a stack like that yourself, and any stack with a
slow cold start: every command reuses what is already running.

For a stack of several services, point `url` at the one that is ready last,
not at the page. A dev server answers seconds before the API behind it, and a
clip that opens too early meets a sign-in form with nothing to sign in to.

### Presentation

`theme.presentation` is what surrounds the app in the video. A backdrop, a
device frame and padding are off by default, because the product should
record the product. They are there for a clip that should look like a
product shot, on a landing page say. A caption is drawn over the app on a
soft scrim unless `caption` says otherwise.

```ts
theme: {
  presentation: { captionInset: { right: 40 } },
},
```

| Field | Default | What it sets |
|---|---|---|
| `backdrop` | none | Behind the app: two colours for a diagonal gradient, or one flat colour. |
| `frame` | `false` | Rounded corners, a hairline and a drop shadow around the app. |
| `padding` | `0` | How far in the app is drawn, as a fraction of the video's shorter side, up to 0.3. |
| `caption` | `"auto"` | Where captions go: `"below"` the app, `"overlay"` on it, or `"none"`. `"auto"` is below when padding makes room, and over the app when it does not. |
| `captionInset` | `{ left: 40 }` | Where a caption over the app sits: `{ left: n }` or `{ right: n }`, pixels of the video in from that side. `right` puts it in the bottom-right corner, for an app whose own controls are at the bottom left. |

A caption inset is in the video's pixels. The video is `output.width` wide,
1920 unless the config says otherwise, so with a page 1440 wide, four of the
video's pixels are three of the page's.

## Write a clip

A clip is a file that default-exports `clip(id, options, body)`. The body
drives the app through `s`, its session.

```ts
import { clip } from "versioncam";

export default clip("02-find-a-shipment", { title: "Find a shipment" }, async (s) => {
  await s.open("/");
  s.caption("Find a shipment");
  await s.hold(500);

  await s.camera.zoom(s.byTestId("shipments"), 1.35);
  await s.typeInto(s.byTestId("filter"), "berg");
  await s.settle({ label: "filtered" });

  await s.highlight(s.byTestId("list-status"), "ring", { for: 1500 });
  await s.hold(1600);
});
```

Every `await` advances the clip's time and captures frames as it goes.
`s.camera.*`, `s.highlight` and `s.caption` write to tracks at the current
instant and cost no time. `s.offCamera(page => …)` runs raw Playwright with
nothing captured, for setup that should not appear, such as mocking an API.

Target elements by test id or role, never by coordinates. Strokes (`s.drag`
for a straight one, `s.lasso` for a closed loop) are written in fractions of a
target's box for the same reason. A clip built from locators survives a layout
change.

`npx versioncam dsl` prints every method with its options and defaults, and a
test holds that list to the session's code. The same reference is
*The clip DSL*.

| Option | Default | What it sets |
|---|---|---|
| `title` | required | The clip's name, kept in its timeline. It is not drawn: write a caption with `s.caption`. |
| `seed` | `1` | Seeds the jitter in cursor paths, dwells and typing. A new seed is a new take of the same script. |
| `viewport`, `dpr`, `fps` | the config's | For a clip that needs a different shape. |
| `capture` | the config's | A clip that films a canvas sets `{ forceCaptureEvery: 1 }` here, and one whose app animates in ways better left out sets `{ transitions: "zero" }`. |

### The camera

The camera crops the recorded page as the video plays. There are two ways
to point it.

- **`s.camera.zoom(target, scale)`** frames one thing and stays there: a form
  being filled, an answer to read. `scale` is a ceiling, so a small target
  is framed with room around it.
- **`s.camera.follow()`** follows the cursor at one scale until the next
  camera line. Use it when a clip moves around the page, in place of a zoom
  before each thing the cursor uses, which zooms in and out and pans in fits
  and starts.

```ts
s.camera.follow({ scale: 1.35 });
await s.typeInto(s.byTestId("recipient"), "Mira Halloran");
await s.click(s.byTestId("create-shipment"));
await s.click(s.byTestId("cancel-3")); // across the page, and the camera goes too
s.camera.reset();
await s.hold(1200);
```

A camera that follows keeps the cursor inside a dead zone in the middle of
the frame, and moves only when the cursor leaves it: a move to the next field
of a form does not move the picture. It never shows beyond the page's edge,
and it moves smoothly, without overshooting. Its path is worked out from the
whole cursor track once the clip has run, so it sets off with the cursor
instead of trailing behind it. `s.camera.release()` stops it where it is.

Every camera line starts from wherever the camera is, still or moving, and
eases into its new framing over its `duration`. A zoom written while the last
one is still moving takes over from it without a stop. `s.camera.reset()`
goes back to the whole page.

`versioncam review` warns about a click that lands outside what the camera
shows. *The clip DSL* has every option and its default.

### Look before you write

A clip written from an app's source reaches for controls that are
conditional, renamed, or not rendered at all. Ask the page instead:

```bash
npx versioncam inspect /shipments          # what is on the page and what it is called
npx versioncam measure / '.marker'         # where the matches are, as fractions
```

`inspect` says where each name came from: `[aria-label]`, `[label]`,
`[placeholder]`, `[text]` or `[name]`. That decides the locator. `byLabel`
finds the first two but not a placeholder; `byPlaceholder` finds that.
`measure` prints what each match says, so a beat's `expect` can quote the
status line it waits for instead of guessing at it.

## Commands

Every command works in the directory that holds `versioncam.config.ts`: run
it from there, or name that directory with `--cwd`. `npx versioncam --help`
prints the same list.

### Set up

Once per machine, and once per repository.

```
versioncam install                 the Chromium this version of versioncam records with
    --with-deps                    and its system libraries (Linux CI)
versioncam init                    install the authoring skill into .claude/
    --into <dir>                   into <dir>/versioncam/ instead, for another host
    --force                        overwrite files that are already there
versioncam doctor                  check this machine can record, and that the app starts
versioncam login                   sign in once and save the browser session
```

### Write

Look at the page before writing against it.

```
versioncam inspect <path>          what a clip can click, and where each name came from
    --json                         machine-readable
versioncam measure <path> <sel>    where a selector's matches are, and what they say
versioncam dsl                     the clip DSL: every method, its options and defaults
```

### Record

`check` is the CI command. It does not render: a clip that no longer matches
the app fails while it records, at the step that no longer exists. A video of
the wreckage would help nobody.

```
versioncam record [id…]            drive the app and capture frames
    --draft                        15fps at CSS scale: cheap, for writing clips
versioncam check [id…]             record every clip; exit 1 if any breaks
    --report <file>                and write each clip's result there, as JSON
versioncam stability [id…]         record each clip twice the same way; stable or not
    --runs <n>                     how many times (default 2)
    --full                         at full quality rather than draft
```

### Review

Look at what a recording shows, and check what needs no eyes.

```
versioncam sheet <id>              an eight-frame contact sheet
    --at-marks                     sample the beats instead of even spacing
versioncam frame <id> <n>          one frame at output size, to a png
    --t <seconds>                  pick the frame by time instead
    --at <label>                   or by the beat it shows
versioncam review <id>             the checks that need no eyes; PASS/FAIL, exit 0/1
    --beats <file>                 [{ label, expect }] the clip promised
    --min <s> --max <s>            duration bounds (default 9 and 11)
versioncam preview <id>            open the scrubber in a real browser
    --scene <id>                   preview a scene instead
    --frame <n>                    start at this frame
```

### Output

Turn recordings and scenes into video.

With no ids, `render` renders every recording in `.versioncam/recordings/`,
and stale ones are recordings too: a draft or a trial run, or a clip since
renamed or deleted, stays there until its directory is deleted. It renders
every scene as well. Ids choose among recordings and scenes alike, by
substring, as they choose clips for `record`. `--scene` names a scene
exactly, and it renders whatever the ids are. Without ids, the scenes it
names are the only scenes rendered. An id that matches nothing, or a
`--scene` the scenes module does not define, stops the command before
anything renders.

```
versioncam render [id…]            composite and encode recordings and scenes
                                   no ids: every one, stale recordings included
    --scene <id>                   and this scene, whatever the ids say (repeatable)
    --sequence                     stitch the results into one piece
    --report <file>                and write what it made there, as JSON
```

### Publish

Send what the last run recorded to [version.cam](https://version.cam), which
renders it and keeps it at a living address. `publish` records nothing and
renders nothing: for each clip the config defines, it sends the recording if
the clip's last run passed, or the failure if it did not, so a clip that
broke says so on every page that embeds it. Only the states the service has
not seen are uploaded, so a version that changed one screen sends one
screen.

It needs a credential in the environment, never on the command line:
`VERSIONCAM_OIDC_TOKEN`, which the versioncam GitHub Action requests from
GitHub for the run (no secret to store), or `VERSIONCAM_TOKEN`, a project
token from version.cam for any other CI. `VERSIONCAM_API` points it
somewhere other than `https://api.version.cam`. Outside GitHub Actions it
reads the commit and branch from git; `VERSIONCAM_COMMIT` and
`VERSIONCAM_BRANCH` set them outright.

```
versioncam publish [id…]           send the recordings and their checks to version.cam
    --dry-run                      print what would be sent, and send nothing
    --report <file>                and write the living URLs there, as JSON
```

### From another directory

In a monorepo the app is one directory among many. A command run from
somewhere else, the repository root or a subdirectory of the app, can name
the app's directory. The config, `.env.recording` and `.env`, `.versioncam/`
and any relative path are then that directory's. `--cwd` can go anywhere on
the line.

`npx` runs the versioncam it finds in the directory it is run from, or in the
nearest one above it, never in one below. From above an app that has
versioncam in its own `node_modules`, it runs another copy, or downloads the
latest. So `--cwd` refuses a directory whose own versioncam is not the one
running, and says to `cd` into it instead.

```
versioncam <command> --cwd <dir>   as if run in <dir>, which holds versioncam.config.ts
versioncam --version               which versioncam this is
```

## What a recording leaves behind

`versioncam record` writes each clip to `.versioncam/recordings/<id>/`.

| File | What it holds |
|---|---|
| `timeline.json` | Everything the renderer needs, and everything a reviewer can check. |
| `states/` | The page states the timeline indexes, one image each. |
| `settles.json` | Every wait: what it was still blocked on, and how long it really took. |
| `targets.json` | Where each step's target was when the step began, by the step's index in `steps`: the box of the control it used. New in 0.3.0. |
| `failure.png` | Only after a failure: the page at the moment the clip gave up. |
| `failure.json` | Only after a failure: the message, the frame, the authored second, and the step that was running (its index in `steps` and its call; new in 0.3.0). |

The timeline's `frames` say which state each frame shows. Beside them are the
tracks the renderer draws: `cursor`, `pointer`, `camera`, `highlights` and
`captions`. A camera that follows the cursor, or eases from one move into
another, is kept as a key a frame. Three more fields are there for reading:

- **`marks`** are the clip's beats: one per labelled `settle()`, at the first
  frame that shows what the wait was for. `versioncam sheet --at-marks`
  samples those frames instead of eight even ones. That is the difference
  between a sheet that shows what the clip is about and one that happens to
  miss it.
- **`steps`** are the script's calls, in order, each with the frame it began
  on: `{ "frame": 212, "call": "typeInto" }`. There is one per line of the
  script. `typeInto` is one step, not also the click it makes, and a locator
  is an argument, not a step. A track write spends no time, so it shares a
  frame with the line after it. New in 0.1.3.
- **`meta`** says where the recording came from: `title`, `appCommit`,
  `baseUrl` and `recordedAt`. `recorder` is the versioncam version that made
  it (new in 0.1.3). `captured` is how many frames got a screenshot, and
  `draft` is set on a draft.

### Checks that need no eyes

`versioncam review <id> --beats beats.json` is the half of reviewing a clip
that needs no eyes and no browser. It prints a line per check and exits 0 or 1:

- **duration**: the clip runs as long as `review` in the config says.
- **settles**: no wait gave up.
- **beats**: every beat in the beat sheet has a mark.
- **progress**: the screen changed between one beat and the next.
- **rendered**: nothing was written after the last frame, where no frame
  would show it. A warning, not a failure.
- **onscreen**: every highlight and every click is inside what the camera
  shows. Also a warning.

What needs eyes is what the contact sheet and `versioncam frame` are for. Is
it legible? Is the cursor in the way? Does the frame show what the beat
claimed?

## How it works

Five decisions make a recording repeatable.

**Time is authored, not measured.** The script declares the timeline. The
driver steps the app through it one output frame at a time: it advances the
page's fake clock by exactly 1/fps, then captures. Anything slow, such as a
query, a map tile or a model, happens inside a `settle()`. A settle advances
the clock but captures nothing, so the wait never reaches the video.

**The cursor is real input with a synthetic glyph.** Headless Chrome draws no
pointer. So the driver moves the *real* mouse along a planned path, and hover
and press states really fire in the captured frames. It records that path as
data. The glyph, the press and the ripple are drawn later at output
resolution, so the look can change without recording again.

**Motion is modelled.** Minimum-jerk profiles, slight Bézier arcs, Fitts-law
durations and a dwell before each click. All of it is seeded, so it never
looks metronomic and never differs between runs.

**Rendering needs nothing running.** The page, the recording, the config and
your scenes are served from an in-memory route table. `versioncam render`
needs only a recording on disk and a browser.

**Output follows the viewport.** Record at 1440×900 and the video is 16:10.
For 16:9, record at 1600×900. Nothing is letterboxed or cropped. A backdrop, a
device frame and padding are available through `theme.presentation`, and are
off by default.

## Speed

Writing a clip is a loop: run it, look at it, change a line. What matters is
how long that loop takes.

**Most frames are not photographed.** A clip is mostly frames in which nothing
moved. The screenshot is by far the most expensive thing a frame does: 25 ms,
against half a millisecond for everything else. So the driver takes one only
when the page can have changed. That is when the DOM mutated, the element
under the cursor changed, an animation or a transition is running, input was
just sent, or `forceCaptureEvery` frames have gone by. On the example app that skips 81% to
95% of frames, and the recording is identical either way. A test records every
clip both ways on every push and compares the bytes. The failure it guards
against is not a crash but a video that is quietly wrong.

The one thing the gate cannot see is a surface that redraws itself: a canvas,
a WebGL view, a video. None of them touches the DOM. `forceCaptureEvery`
(default 30) is the floor under that. A clip whose subject *is* a canvas
should set it to 1 and pay full price:

```ts
export default clip("03-the-map", { title: "The map", capture: { forceCaptureEvery: 1 } }, …);
```

**`--draft` for the loop.** Fifteen frames a second, captured at CSS scale
instead of device scale, into the same place a full recording goes.

```bash
npx versioncam record --draft 02-find-a-shipment   # then render and look
```

A draft does not change the page: same viewport, same device pixel ratio,
same layout, same code. A draft that lowered the DPR could pass while the
capture it stands in for fails on a media query. It does ignore a clip's own
`fps`, because the point is to be cheap. Its length can land up to 1/15 s from
the full capture's, so a draft is for looking at, not for comparing against.

`versioncam record` prints where the time went. That tells you whether the
next second would come from the frames or from somewhere else:

```
  01-create-a-shipment: 425 frames, 63 states, 1 cut · plays 7.1s · took 6.3s
    open 0.0s · settles 0.5s · frames 5.7s (79 captured, 346 skipped) · write 0.0s
```

`plays` is the clip's own length and `took` is what the machine spent making
it. They move in opposite directions when a clip gets slower to record, which
is why both are named.

## Authoring

A clip is a script, and writing one is a loop: look at the page, write,
record, look at what you got, fix. versioncam ships that loop as one agent
skill. There is no API key and no SDK. The model is whichever agent session
runs the skill, and it reads contact sheets with the same tool it reads files
with.

```bash
npx versioncam init          # .claude/skills/versioncam/ and .claude/agents/versioncam-reviewer.md
# or, for Claude Code without copying anything:
claude --plugin-dir node_modules/versioncam/plugin
```

`init --into <dir>` puts the skill directory somewhere else, for a host that
reads skills from another place. Then ask for a clip:

```
/versioncam "Find a shipment by filtering the list, and show how many matched"
```

**The first run** in a repository with no `versioncam.config.ts` sets it up
before anything else:

1. It works out how the app starts and where it is served, from its scripts
   and its framework's config.
2. It asks you whether the app signs in, and how you want that handled.
3. It writes a config with a `webServer`, so nothing has to be running.
4. It runs `doctor` and `inspect` to prove the app starts and settles.
5. It records a three-second clip twice with `stability`, so no clip is
   written against an app that does not record the same way twice.

It commits nothing.

**In a monorepo** the skill first looks for `versioncam.config.ts` across the
whole repository, wherever the session started, and then works in the
directory that holds it. With several apps, it asks which. With none, the
first run writes the config where `versioncam init` put the skill.

**Every run** then goes the same way. The session inspects the start page and
reads `versioncam dsl` and your existing clips. It writes a beat sheet, then
the clip, and records it in draft until `versioncam review` passes, three
recordings at most. Then comes a contact sheet sampled *at the beats*, and a
fresh reviewer.

**The reviewer** is `versioncam-reviewer`, new every round. It sees the
picture, the beats and a five-item checklist, and nothing of how the clip was
written: a reviewer that has read the author's reasoning agrees with it. Its
verdict comes back as fixes to make, and the round repeats. After six rounds
at most it stops and says why. On a host that cannot register the reviewer as
an agent, the same file is a subagent's prompt. On a host with no subagents at
all, it is a checklist the session applies to its own sheet, and the verdict
says which.

**What you get** is under `.versioncam/author/<id>/`: the beat sheet, a
`summary.json`, the final sheet, and for each round what the author found,
its beats and the reviewer's verdict. The clip itself goes in your clips
directory. That is the part worth reading and committing.

**What it costs.** Six to twelve minutes and one or two rounds for a clip on
the example app, most of it model latency rather than the recorder. It is not
cheap and it is not instant. It is, however, unattended.

**What it is not.** The skill cannot sign your app in for you. It asks how you
want that handled, and `versioncam login` is yours to run because it waits
for you. It does not run `git`. And `versioncam review` only checks what
needs no eyes. Whether the clip is *good* is the reviewer's job, and after
that, yours.

## Determinism

Two runs of a clip on one machine produce the same bytes, draft and full. The
package's own tests assert it for capture and for rendering on every change,
on macOS and on Linux. A golden recording pins the capture path against
changes nobody meant to make.

A render is the same bytes every time it is made from one recording, on one
ffmpeg build, with one encoder thread count. The thread count otherwise
follows the machine's cores, so a render that must match another machine's
fixes it with `output.threads` or `VERSIONCAM_FFMPEG_THREADS`. Before 0.3.0
every WebM carried a random id and no two were the same file.

Across machines the claim is narrower. The **timeline** is identical: it is
what the driver decided, and nothing in it depends on the host. The captured
**pixels** are identical only where the rendering environment is. macOS and
Linux rasterise text differently, so the same page in the same state is the
same picture and a different file. Byte-identity belongs to a fixed
environment. In CI that means one runner image, and the Playwright container
for the version versioncam pins is the simplest (see *In CI*).

If two recordings of your clip on one machine differ, something outside the
authored clock reached a frame: an unwarmed resource, a real timer, a font
that had not finished loading. Find the cause. The next section is how.

### The app's own motion

The page runs on a fake clock that moves only when the recorder moves it: a
frame's worth at a time while frames are made, and in small ticks while a
settle waits. The app's timers and animation frames run on it, and so does
its CSS motion:

- **Transitions play** at their authored duration and easing, on the page's
  clock, from the frame the recorder first sees each one. A menu fades in, a
  drawer slides, a map zooms over its frames, and `transitionend` fires on
  the frame its time runs out. A settle waits until none is running, so the
  frame after it shows them finished. `capture: { transitions: "zero" }`
  makes them take no time instead, as before 0.4.0, in the config or in one
  clip.
- **Animations are scrubbed** by the clip's time: a spinner turns at the rate
  the video plays, whatever the machine is doing. The scrub counts from the
  clip's start, not the animation's, so a one-off animation that starts
  partway through a clip shows its end.
- **Not on the clock:** animations a script makes with `element.animate()`,
  Chromium's smooth scrolling of a mouse wheel, and transitions inside an
  iframe, which stay zeroed since nothing drives an iframe's clock. A clip
  that films one of the first two may differ between runs: `stability` says
  so.

### When a clip will not reproduce

The recorder can only be as deterministic as the app it films. An app that is
*nearly* deterministic is the hard case: it reproduces on most runs, so the
first failure looks like a recorder bug.

Before assuming it is one, record the clip twice the same way. `stability`
does exactly that, and compares the runs frame by frame, by what each frame
shows:

```bash
npx versioncam stability 02-find-a-shipment          # draft; --full for the real thing
```

```
02-find-a-shipment: run 1 vs run 2 · 268 frames, 264 identical, first difference at frame 131
  .versioncam/stability/02-find-a-shipment/frame-131-run1.png
  .versioncam/stability/02-find-a-shipment/frame-131-run2.png
unstable: something on this page does not run on authored time
```

The two files are the pictures behind the first frame that differs. Side by
side, what differs is usually obvious. Each run records beside the clip's own
recording, under `recordings/__stability/`, never over it. With no id it
checks every clip, and it exits 0 only when every pair matched. That makes it
the first thing to run in a repository before writing a clip for it, and it
is what the authoring skill does on a first run.

If the runs differ, something on the page did not run on authored time. Look
at the app first, but not only there: of the four causes found so far, the
recorder was two. What we have found doing this:

- An **autosizing text field** that settles a frame later depending on how the
  browser scheduled the layout. The clips that typed diverged. The clips that
  did not, did not.
- A **spinner**, the recorder's fault and since fixed. The screenshot was
  cancelling the animation the driver had just scrubbed. The symptom was six
  pixels in one frame of three hundred, which reads as noise rather than as a
  bug.
- A **typed letter's edge**, the recorder's fault and since fixed. A draft's
  screenshot has Chromium paint the page again at CSS scale. It repainted only
  the rectangle the page reported as changed, which at that scale could stop
  a pixel short of a new glyph's antialiased edge. This happened only on
  Linux, where text has LCD antialiasing: one pixel of one frame, in about
  half of all runs. Side by side the two pictures look identical; subtracting
  one from the other finds it.
- A **timer firing early**, the recorder's fault and since fixed. The page's
  fake clock was installed but left running on real time between frames, so a
  slow screenshot reached the page as time. One stalled frame on a CI runner
  moved the clock 840 ms instead of 67, and the example app's shipment
  appeared seven frames early. The clock is paused now and moves only when
  the driver moves it.

If the two recordings match and something else does not, ask what changed
between them: the gate (`capture: { gate: false }` turns it off), or the
machine.

## While recording

Do not edit files. A dev server pushes a full page reload to every connected
client, including the page being recorded. The driver detects it and says so,
but the run is lost either way.

Record one clip at a time against a given app session. The CLI already does.
The thing to avoid is a browser tab left open on the same session.

## Glossary

The words these pages use in a particular sense.

| Word | Meaning |
|---|---|
| authored time | The clip's own clock. The page's clock moves only when the driver moves it, one frame at a time. |
| beat | A moment the clip exists to show. A labelled `settle()` marks one. |
| beat sheet | The beats a clip promises, as `[{ label, expect }]`. `versioncam review --beats` checks a recording against it. |
| clip | A script, `*.clip.ts`, that drives the app and says what to show. One clip makes one video. |
| contact sheet | Eight frames of a recording in one image, for judging it at a glance. `versioncam sheet` makes one. |
| draft | A cheap recording for writing clips: 15 frames a second, captured at CSS scale. |
| gate | The check that skips a screenshot when nothing on the page can have changed. |
| mark | Where a beat first shows, in the timeline's `marks`. |
| recording | What `record` leaves in `.versioncam/recordings/<id>/`: the timeline and the page states it indexes. |
| render | Drawing the cursor, camera, highlights and captions over a recording, and encoding the video. |
| reviewer | The fresh agent that judges a contact sheet against the beats and a five-item checklist. |
| scene | A designed panel: frames drawn in code rather than captured from the app. |
| settle | A wait that advances the page's clock but captures nothing, so it never reaches the video. |
| stable | Two recordings of a clip, made the same way on one machine, are identical. |
| step | One line of the script, as the timeline's `steps` records it. |
| timeline | `timeline.json`: which state each frame shows, and every track drawn over it. |
| track write | A call to `camera`, `highlight` or `caption`. It writes at the current instant and spends no time. |

## Help

Bugs, questions, and apps it cannot record go to the issue tracker at
[github.com/versioncam/versioncam-home](https://github.com/versioncam/versioncam-home/issues).
A clip that will not reproduce is easiest to help with alongside the two
pictures `versioncam stability` saves.

## Licence

Versioncam is under the Functional Source License, version 1.1, with Apache
2.0 as its future licence (`FSL-1.1-ALv2`). Use it on your own apps and in
your own CI, commercial work included, and change it as you need. What the
licence does not allow is making it available to others in a product or
service that competes with it. Two years after each version is released, that
version is also available under Apache 2.0. This is a summary; `LICENSE.md`
is the licence.
