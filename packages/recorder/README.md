# versioncam

Record demo clips of your real web app. Each clip is a script, two runs of it
on one machine produce the same video, and CI records it again on every push.

A clip is a script in your repository. It drives your app through its own
controls in a real browser and captures what the page shows. Then it draws a
cursor over the frames, applies the clip's zoom and pan to them, and encodes a
video. Record it again on
every push. When the app changes under a clip, the clip *fails*: it names the
control it could not find and the second it gave up. It never turns into a
video that is quietly wrong.

## Install

Run three commands, then give your agent one sentence:

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

An app that is not written for Node installs versioncam the same way, in its own
directory. npm creates a `package.json` there if there is none, and you add
`node_modules/` to `.gitignore`. Nothing else depends on the app's language.
`webServer` runs any command (`.venv/bin/python manage.py runserver 8000`,
`bin/rails server`), and the recorder records a server-rendered app like any
other, page loads included.

`npx versioncam doctor` checks the rest: Node 22 or later, Chromium, ffmpeg,
your config and the scenes module it names, if any, and whether the app
starts. ffmpeg and ffprobe come from the
system (`brew install ffmpeg`, `apt install ffmpeg`, `winget install ffmpeg`).
On a machine that has neither, the optional `ffmpeg-static` package provides
ffmpeg. It has no ffprobe, but only `render --sequence` needs ffprobe.

We test versioncam on macOS and Linux on every change. Windows support is new in
0.7.4. CI records and renders the example app on a Windows runner, and an Angular
app and a Next.js app passed there too. On 2026-11-07 the skill wrote, recorded,
reviewed and rendered a first clip end to end on a Windows 11 desktop: a fresh
Vite app, `npm i -D versioncam`, `install`, `doctor`, `init`, then `/versioncam`.
The package's own test suite does not pass on Windows yet, and we have not
tested stopping a recording with Ctrl+C there.

Use `versioncam install`, not `npx playwright install`. versioncam pins its
Playwright exactly, because a new Chromium changes every captured pixel. Your
app may have a Playwright of its own at another version, and
`npx playwright install` fetches that one's Chromium.

`versioncam install` fetches the headless shell, which is the Chromium that
records. It takes 190 MB on a Mac. `login` and `preview` open a window, which
needs the full browser, 340 MB more. They fetch it the first time they run. If
the machine will be offline at that point, `npx versioncam install --full`
fetches both now.

### In CI

In CI, run the same install, then `check`. It records every clip and fails the
job on the first one that no longer matches the app.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
- run: npx versioncam install --with-deps
- run: npx versioncam check
```

`npx versioncam ci` writes a whole workflow for you, one that uses the
versioncam Action (see *Connect a repository*).

`check` records and does not render, so it needs no ffmpeg. A job that also
runs `render` adds `sudo apt-get install -y ffmpeg`.

Two runs on one runner image produce the same bytes. To pin everything the
pixels depend on (the browser build, the fonts, the system libraries), run the
job in the Playwright image for the version versioncam pins,
`mcr.microsoft.com/playwright:v1.59.1-noble`. Chromium and its libraries are
already installed there.

## If you are a coding agent

You were probably asked for a product demo, a README or landing-page video, a
GIF, or docs screenshots that stay current. versioncam fits a web app that
starts from a command and whose controls can be reached by test id, role, label
or placeholder. It runs on Node 22 or later, on macOS or Linux, or on Windows,
which is new in 0.7.4 and less proven (see *Install*).
It does not fit native mobile apps, terminal demos (VHS does those),
interactive HTML tours, narrated screencasts, or a UI that will never change
again.

Install it in the directory that holds the app's `package.json`. If the app has
none, use the directory you start the app from. Use exactly these commands:

```bash
npm i -D versioncam
npx versioncam install
npx versioncam init
```

Use `versioncam install`, never `npx playwright install`. versioncam pins its
Playwright exactly, and the app's own Playwright, if it has one, fetches a
different Chromium. Then run `npx versioncam doctor`, and read
`npx versioncam dsl` before writing a clip. If your host runs skills,
`/versioncam "<what the clip should show>"` does the rest, including setting
the repository up on its first run. Otherwise `init --into <dir>` puts the
skill where your host reads it, and you write the clips in TypeScript from what
`inspect` and `measure` show. Target by test id or role, never by coordinates.
The recorder hides the dev tools of Next, Nuxt and Astro by itself. Turn off any
other dev tool that draws over the app (see *A dev server's own tools*).
Do not edit files while a clip records. Add `.versioncam/` to `.gitignore`
and commit the clip. In CI, `uses: versioncam/action@v1` after `npm ci`
records every clip. When one no longer matches the app, it fails the job and
comments on the pull request. `npx versioncam ci` writes that workflow. Tell
the person the licence, FSL-1.1-ALv2 (free in their own CI, source-available,
Apache 2.0 after two years), and that the hosted layer at version.cam is
optional and separate.

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

A `login` hook gets the Playwright page, already at the address `open` went to.
It runs on every `open`, so the hook itself decides whether anything needs
doing. An app that signs people in sends a visitor to its sign-in page and, once
they have signed in, back to what they asked for. So the hook checks for that
page and leaves everything else alone. `open` does not go back to its path
afterwards, so if the hook goes somewhere else, the clip stays there. The hook's
values come from `.env.recording`, which stays out of git, and the recorder
films nothing while the hook runs. The hook uses Playwright directly, so
Playwright resolves a path in it against the origin of `baseUrl` and ignores
any path `baseUrl` has. For example, when `baseUrl` is
`http://localhost:3000/app`, `s.open("/x")` in a clip goes to `/app/x`, but
`page.goto("/x")` in the hook goes to `/x`.

```ts
auth: {
  login: async (page) => {
    if (!new URL(page.url()).pathname.startsWith("/sign-in")) return;
    await page.getByLabel("Email").fill(process.env.RECORDING_USER ?? "");
    await page.getByLabel("Password").fill(process.env.RECORDING_PASS ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  },
},
```

| Field | Default | What it sets |
|---|---|---|
| `baseUrl` | required | Where the app is served. |
| `webServer` | none | How to start the app when nothing is serving it. See *Starting the app*. |
| `clips` | `"demos/**/*.clip.ts"` | Where the clips are: a glob, or a list of them, relative to the config. |
| `viewport` | `{ width: 1440, height: 900 }` | The page's size. The video has the same shape. |
| `dpr` | `2` | Device pixel ratio, from 1 to 3. At 2, a zoom shows real pixels. |
| `fps` | `60` | Frames per second, from 10 to 120. |
| `output` | `{ width: 1920 }` | The length of the video's longer side. A landscape clip is this wide and a portrait clip this high, and the other side follows the viewport. `threads` fixes how many threads each encoder uses. An encoder's bytes depend on it, so with a fixed number the same recording renders to the same file on any machine. `VERSIONCAM_FFMPEG_THREADS` sets it for one run. |
| `auth` | none | How the app signs in: a saved session, `{ storageState }`, or a hook, `{ login }`. |
| `settle` | `quietMs: 150`, `timeoutMs: 15000`, `yieldMs: 20` | When a page counts as done. `ready` adds a condition of your own. |
| `capture` | `gate: true`, `forceCaptureEvery: 30`, `transitions: "play"` | Which frames get a screenshot (see *Speed*), and whether the app's CSS transitions play on its clock or take no time, `"zero"` (see *Determinism*). |
| `review` | `minSeconds: 9`, `maxSeconds: 11` | How long a clip should run. `versioncam review` holds clips to it. |
| `cursorStart` | `{ x: 0.72, y: 0.28 }` | Where the cursor rests in the first frame, as fractions of the viewport. |
| `clock` | `time: "2026-09-01T09:00:00Z"`, `timezoneId: "UTC"`, `locale: "en-GB"` | The instant, time zone and locale the app sees. |
| `theme` | `accent: "#2f6fed"`, `cursorScale: 2.1`, `cursor: { style: "light", ripple: true }` | The colour of ripples and rings, the cursor's size and look, and an optional `presentation`. `cursor: { style: "dark", ripple: false }` draws the system's black arrow and no ring on a click, as a screen recording shows them. See *Presentation*. |
| `motion` | `MOTION` | Dwells, strokes, scrolls and camera timing. `MOTION` is exported, with the reason for each number beside it. |
| `replay` | none | Responses recorded once and served on every run after: tiles, a model's answers, a job's status. See *Live data*. |
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

1. It asks `url` whether anything is serving. Any answer below 500 counts,
   including a 401 or a redirect. A 5xx means the server cannot serve yet
   (Nuxt's dev server answers with one while it compiles), so the command keeps
   asking until `timeoutMs`. Then it stops and says what it got.
2. If something answers, it uses that server as it is and leaves it running.
   With `CI` set it refuses instead, because on a runner a server that was up
   before the job started is not the build under test. `reuseExistingServer: true`
   allows it.
3. If nothing answers, it runs `command` with the shell's environment plus
   `env`. It does not pass on what the recorder loaded from `.env.recording`
   for itself. It waits for `url` to answer and writes the server's output to
   `.versioncam/webserver.log`.
4. When it finishes, normally, on an error or on Ctrl-C, it stops what it
   started. It signals the command's whole process group: SIGTERM, then
   SIGKILL after five seconds. The log says which one it took.

versioncam cannot stop a process that `command` hands off to outside its
process group, such as a container runtime. It warns when the port still
answers after the stop. Start a stack like that yourself, and also any stack
that is slow to start cold. Every command reuses what is already running.

For a stack of several services, point `url` at the one that is ready last,
not at the page. A dev server answers seconds before the API behind it. A clip
that opens too early finds the sign-in form, but the API that signs you in is not
up yet.

### Presentation

`theme.presentation` is what surrounds the app in the video. A backdrop, a
device frame and padding are off by default, because the video should show
the product. Use them for a clip that should look like a product shot, on a
landing page for example. Unless `caption` says otherwise, the recorder draws a
caption over the app, on a dark gradient along the bottom of the video.

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

A caption inset is in the video's pixels, not the page's. The video is
`output.width` wide, 1920 unless the config says otherwise. So with a page
1440 wide, the video is 4/3 the page's width, and an inset of 40 video pixels
is 30 of the page's. When versioncam loads the config, it refuses an inset of
`output.width` or more. A phone clip's video is narrower than that, so
give a config with phone clips an inset that fits them too.

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

To show a long answer or a list, scroll it. `s.scroll` scrolls on the clip's
clock, one step a frame, so every frame of it is the same on every run. Give it the pane that scrolls, or `"page"`, and where to go: `{ by: 400 }`,
`{ to: "bottom" }`, or `{ into: s.byTestId("citation-3") }` to bring one thing
into view.

```ts
await s.moveTo(s.byTestId("answer"));
await s.scroll(s.byTestId("answer"), { into: s.byTestId("citation-3") });
```

The cursor stays still while the pane moves, so move it over the pane first,
where a hand on a mouse wheel would be.

To film an upload, use `s.fileWindow`. It draws a file window over the page,
because the browser's own file dialog is outside the page. The clip selects
files in it and drags them onto the app's dropzone, which receives them as real
files through the events a real drag sends. versioncam draws the window; it is
not the operating system's real one, so say so where the clip is shown.

```ts
const files = await s.fileWindow([{ name: "cases.csv", content: csv }], { title: "Case data" });
await s.drag(files.item(0), s.byTestId("dropzone"));
```

When a page loads another document, such as a plain link or a form post on a
server-rendered app, the recorder films it like anything else that takes time.
The video cuts to the new page once it has finished loading, however long the
server took. Give the beat a label with `s.settle` after the click. If the page
has not arrived after 90 seconds, the clip fails and names the address it was
going to. A second `s.open` goes to another page, and the clip carries on from
there. The new page's clock starts where the old page's clock stopped. It does
not advance while the server is slow to answer, so the wait leaves no gap in the
clip's time. A reload nobody asked for still fails the clip (see
*While recording*).

```ts
await s.typeInto(s.byLabel("Username"), "mira");
await s.click(s.byRole("button", { name: "Log in" }));
await s.settle({ label: "signed in" });
```

`npx versioncam dsl` prints every method with its options and defaults. A test
in this package checks that the list matches the session's code. *The clip DSL*
is the same reference.

| Option | Default | What it sets |
|---|---|---|
| `title` | required | The clip's name, kept in its timeline. It is not drawn: write a caption with `s.caption`. |
| `seed` | `1` | Seeds the jitter in cursor paths, dwells and typing. A new seed is a new take of the same script. |
| `viewport`, `dpr`, `fps` | the config's | For a clip that needs a different shape. A phone clip sets `viewport: { width: 390, height: 844 }` and renders 888 by 1920 at the default output; name it `<id>-mobile` and version.cam shows it in place of `<id>` on a narrow screen (see *version.cam*). |
| `capture` | the config's | A clip that films a canvas sets `{ forceCaptureEvery: 1 }` here, and one whose app animates in ways better left out sets `{ transitions: "zero" }`. |

### A phone clip

A phone clip is a second file with a phone's viewport and the desktop clip's id
with `-mobile` on the end. When the story is the same on both, the body goes in a
file of its own that both import, under any name that is not `*.clip.ts`:

```ts
// demos/stories/checkout.ts
import type { ClipBody } from "versioncam";

export const checkout: ClipBody = async (s) => {
  await s.open("/checkout");
  await s.click(s.byTestId("pay"));
  await s.settle({ label: "paid" });
  await s.hold(2000);
};

// demos/clips/01-checkout.clip.ts
import { clip } from "versioncam";
import { checkout } from "../stories/checkout";

export default clip("01-checkout", { title: "Checkout" }, checkout);

// demos/clips/01-checkout-mobile.clip.ts
import { clip } from "versioncam";
import { checkout } from "../stories/checkout";

export default clip(
  "01-checkout-mobile",
  { title: "Checkout", viewport: { width: 390, height: 844 } },
  checkout,
);
```

A phone layout often hides some of the desktop's controls and adds others,
such as a menu button and what is behind it. `npx versioncam inspect /checkout --viewport
390x844` lists what it has. Where the steps differ, write two bodies.

An id picks clips by substring unless it is exactly a clip's id, so
`record 01-checkout` is the desktop clip, `record 01-checkout-mobile` the phone
clip, and `record checkout` both.

### The camera

The camera crops the recorded page as the video plays. There are two ways
to point it.

- **`s.camera.zoom(target, scale)`** frames one thing and stays there: a form
  being filled, an answer to read. `scale` is a ceiling, so a small target
  is framed with room around it.
- **`s.camera.follow()`** follows the cursor at one scale until the next
  camera line. Use it when a clip moves around the page. A zoom before each
  thing the cursor uses would zoom in and out and pan in fits and starts.

```ts
s.camera.follow({ scale: 1.35 });
await s.typeInto(s.byTestId("recipient"), "Mira Halloran");
await s.click(s.byTestId("create-shipment"));
await s.click(s.byTestId("cancel-3")); // across the page, and the camera goes too
s.camera.reset();
await s.hold(1200);
```

A camera that follows keeps the cursor inside a dead zone in the middle of
the frame, and moves only when the cursor leaves it. A move to the next field
of a form does not move the picture. It never shows beyond the page's edge,
and it moves smoothly, without overshooting. The recorder works out its path
from the whole cursor track after the clip has run, so it starts moving with
the cursor instead of trailing behind it. `s.camera.release()` stops it where it is.

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
npx versioncam inspect / --viewport 390x844  # the same, at a phone's size
```

`inspect` says where each name came from: `[aria-label]`, `[label]`,
`[placeholder]`, `[text]` or `[name]`. That tells you which locator to use.
`byLabel` finds the first two but not a placeholder, and `byPlaceholder` finds
that.
`measure` prints what each match says, so a beat's `expect` can quote the
status line it waits for instead of guessing at it.

## Commands

Every command works in the directory that holds `versioncam.config.ts`: run
it from there, or name that directory with `--cwd`. `npx versioncam --help`
prints the same list.

### Set up

Run these once per machine, and once per repository.

```
versioncam install                 the headless Chromium this version of versioncam records with
    --with-deps                    and its system libraries (Linux CI)
    --full                         also the full Chromium, which login and preview need to open a window
versioncam init                    install the authoring skill into .claude/
    --into <dir>                   into <dir>/versioncam/ instead, for an agent that reads skills from elsewhere
    --force                        overwrite files that are already there
versioncam doctor                  check this machine can record, and that the app starts
versioncam login                   sign in once and save the browser session
```

### Write

Look at the page before writing against it.

```
versioncam inspect <path>          what a clip can click, by accessible name, and where each name came from
    --json                         machine-readable
    --viewport <w>x<h>             at this size: 390x844 for a phone clip
versioncam measure <path> <sel>    where a selector's matches are, and what they say
    --viewport <w>x<h>             at this size
versioncam dsl                     the clip DSL: every method, its options and defaults
```

### Record

`check` is the CI command. It does not render. A clip that no longer matches
the app fails while it records, at the step that no longer exists, and a video
of the failure would help nobody.

```
versioncam record [id…]            drive the app and capture frames
    --draft                        a quick recording at 15fps in CSS pixels, for writing clips
    --replay <mode>                how to use recorded network answers, overriding the config: auto, record, replay or live
versioncam check [id…]             record every clip; exit 1 if any breaks
    --report <file>                and write each clip's result there, as JSON
versioncam stability [id…]         record each clip twice the same way, and say if they match
    --runs <n>                     how many times (default 2)
    --full                         at full quality rather than draft
    --replay <mode>                as for record
```

### Review

Look at what a recording shows, and check what needs no eyes.

```
versioncam sheet <id>              an eight-frame contact sheet
    --at-marks                     one tile per beat instead of even spacing
versioncam frame <id> <n>          one frame at output size, to a png
    --t <seconds>                  pick the frame by time instead
    --at <label>                   or by the beat it shows
versioncam review <id>             the automatic checks, PASS or FAIL, with exit code 0 or 1
    --beats <file>                 the beats the clip should show, as [{ label, expect }]
    --min <s> --max <s>            duration bounds (default 9 and 11)
versioncam preview <id>            open the scrubber in a real browser
    --scene <id>                   preview a scene instead
    --frame <n>                    start at this frame
```

### Output

Turn recordings and scenes into video.

With no ids, `render` renders every recording in `.versioncam/recordings/`,
stale ones included. A draft, a trial run, or the recording of a clip you have
since renamed or deleted stays there until you delete its directory. Ids
choose among recordings and scenes alike, by substring, as they choose clips
for `record`, and an id that is exactly a clip's id picks that one alone.
`--scene` names one scene exactly. This is what each combination renders:

- No ids and no `--scene`: every recording and every scene.
- Ids: the recordings and scenes the ids choose.
- `--scene` with ids: what the ids choose, plus each scene `--scene` names.
- `--scene` with no ids: every recording, and only the scenes `--scene` names.

An id that matches nothing, or a `--scene` the scenes
module does not define, stops the command before anything renders.

```
versioncam render [id…]            composite and encode recordings and scenes
                                   with no ids, it renders all of them, stale recordings too
    --scene <id>                   also render this scene, even when the ids leave it out (repeatable)
    --sequence                     stitch the results into one piece
    --report <file>                and write what it made there, as JSON
```

A clip has no sound. The files carry a video stream only, so a player's
mute control has nothing to do. Narration is not a feature yet.

Rendering is the slow step. It draws every frame and encodes two videos, so a
ten-second clip takes one to two minutes on a laptop. At a terminal, it says
what it is rendering. Use `record --draft` and `versioncam sheet` to look at a
clip before that.

### Publish

Send what the last run recorded to [version.cam](https://version.cam), which
renders it and keeps it at a permanent link. `publish` does not record or
render anything. For each clip the config defines, it sends the recording if
the clip's last run passed, or the failure if it did not, so version.cam
knows when a clip broke (see *When a clip breaks*). It uploads only the states
version.cam has not seen, so a version that changed one screen sends one
screen. `versioncam ci` writes the GitHub Actions workflow that runs `check`
and `publish` for you (see *Connect a repository*).

It needs a credential in the environment, never on the command line. That is
either `VERSIONCAM_OIDC_TOKEN`, which the versioncam GitHub Action requests
from GitHub for the run (no secret to store), or `VERSIONCAM_TOKEN`, a project
token from version.cam for a repository outside GitHub (see *Other CI*).
`VERSIONCAM_API` points it somewhere other than `https://api.version.cam`.
Outside GitHub Actions it reads the commit and branch from git.
`VERSIONCAM_COMMIT` and `VERSIONCAM_BRANCH` set them directly.

```
versioncam publish [id…]           send the recordings and their checks to version.cam
    --dry-run                      print what would be sent, and send nothing
    --report <file>                and write the clips' permanent links there, as JSON
versioncam ci                      write the GitHub Actions workflow that checks and publishes the clips
    --print                        print it instead, and write nothing
    --force                        replace the workflow file if there is one
```

### Manage

See what version.cam knows about a project, and change its settings, from the
command line. These commands show and do what the dashboard does, once you have
signed in with a code you approve in a browser. A setting changes only when you
approve that one change in the browser too. These commands need no
`versioncam.config.ts`, and run anywhere in a clone of the repository. See
*From the command line*.

```
versioncam cloud login             sign in to version.cam, with a code you approve in a browser
    --label <name>                 what the approval page calls this machine
versioncam cloud logout            sign out, which revokes the token and deletes it
versioncam cloud status [project]  each clip, current or broken, and the version its link plays while broken
versioncam cloud failure <clip>    print why a clip broke, and save its picture in .versioncam/failures/
versioncam cloud ack <clip>        acknowledge a broken clip, which stops the reminders
versioncam cloud embed <clip>      the snippets that embed a clip, and its files
versioncam cloud set <name> <val>  change a setting, once you approve it in a browser:
                                   visibility public|unlisted|private, retention <days>|off,
                                   viewers on|off, alerts email|slack <address>|off,
                                   alerts issues on|off
versioncam cloud plan [account]    the plan, and the links to upgrade and to billing
    --project <owner/repo>         which project, when not this repository's
    --json                         machine-readable, for status, failure, embed and plan
```

### From another directory

In a monorepo the app is one directory among many. A command run from
somewhere else, such as the repository root or a subdirectory of the app, can
name the app's directory. The config, `.env.recording` and `.env`,
`.versioncam/` and any relative path then belong to that directory. `--cwd` can
go anywhere on the line.

`npx` runs the versioncam it finds in the directory it is run from, or in the
nearest one above it, never in one below. If you run it from above an app that
has versioncam in its own `node_modules`, it runs another copy or downloads the
latest. So `--cwd` refuses a directory whose own versioncam is not the one
running, and tells you to `cd` into it instead.

```
versioncam <command> --cwd <dir>   as if run in <dir>, which holds versioncam.config.ts
versioncam --version               which versioncam this is
```

## version.cam

[version.cam](https://version.cam) renders what `versioncam publish` sends
and keeps each clip at a permanent link,
`clips.version.cam/<owner>/<repo>/<clip>`. It plays the newest version from
your default branch that passed, so a page that embeds it never needs
editing. You manage projects on [app.version.cam](https://app.version.cam).

### Phone and desktop in one link

A clip whose id is another clip's id with `-mobile` on the end is that
clip's phone version: `01-checkout-mobile` beside `01-checkout`, recorded at
a phone's viewport. The clip's page, its embed page and the `<version-cam>`
element of its script snippet show the phone clip on a screen under 768 CSS
pixels wide and the desktop clip on a wider one, so one link serves both. The
element measures its own width, not the window's, and takes the shape of the
clip it will show. The plain snippets cannot do that. The video snippet is the
desktop clip's file. The iframe snippet keeps the desktop clip's shape. Without
a script, an iframe cannot change the size of the box the page gave it, so on a
phone the phone clip plays inside that desktop-shaped box. Use the element where a page should fit both. Until the phone clip has a video, the desktop clip shows everywhere.
The phone clip has its own page and snippets as well, to place it by hand.

The recorder sets the viewport and nothing else: no touch events and no
phone user agent. An app that picks its phone layout by the window's width
records its phone layout. An app that picks it by the user agent records its
desktop layout, squeezed into the phone's width.

### Connect a repository

1. Install versioncam and record a first clip. *Install* and the authoring
   skill do that.
2. Run `npx versioncam ci`. It writes `.github/workflows/versioncam.yml` at the
   repository's root. In that workflow the
   [versioncam Action](https://github.com/versioncam/action) checks the clips
   on every pull request. On every push to the default branch it checks them
   and then publishes them to version.cam. It signs in with GitHub's own token,
   so there is no secret to store. If your app needs more than `npm ci` to
   install, change that step. `--print` prints the file instead of writing it,
   and `--force` replaces an existing one. After writing the file, the command
   says what comes next. That depends on whether the repository is public or
   private. The command asks GitHub's public API which it is, without a token.
3. Push to the default branch. The first push publishes, and that is when the
   repository's project appears on version.cam. It also appears when someone
   installs the GitHub App on the repository.
4. Sign in to see the project and change its settings: at
   [app.version.cam](https://app.version.cam) with GitHub, or with
   `npx versioncam cloud login` from a terminal (see *From the command line*).
   `npx versioncam cloud status` tells you when a repository is not on
   version.cam yet, and what to do.

A private repository needs the
[Versioncam GitHub App](https://github.com/apps/versioncam), and the Pro plan.
Install the App on the repositories you choose. It is how version.cam knows
who may see a repository's clips. Whoever can read a repository on GitHub sees
its project, and whoever administers it changes the project's settings.
version.cam learns this from GitHub each time someone signs in. The App also
reports each publish on GitHub. It puts a check on the commit, and on a pull
request it posts a comment naming the clips that look different and the ones
that failed.

### Plans

Priced per project, not per seat. The prices are marked "planned" because we
will confirm them after the first invoices. Free is for public repositories:
three projects, ten clips a project, thirty days of history, clips up to sixty
seconds, a gigabyte, the pull request check and the badge. Pro costs $35 a
project a month or $350 a year. It adds private repositories, unlimited
history and a hundred clips a project, and we email your team, post to Slack or
open a GitHub issue when a clip breaks. Max costs $145 a month for ten projects
with everything Pro has. The recorder and the Action are free whatever the
plan. version.cam is in private beta, so you can't buy a plan yet and we don't
ask for a card. Free works for anyone who signs in. The first ten people who
ask at hello@version.cam get Pro for free until the beta ends.

### When a clip breaks

A clip breaks when its check fails on the default branch: a control it uses
was renamed or removed, a page moved, a step waited for something that never
came, or the app would not start. A change in how the app looks never breaks
a clip. It makes a new version.

Your pages keep playing the last version that passed, and say nothing about
the break. If you want viewers to know, for open source docs perhaps, turn on
"Tell viewers when a clip is broken" in the project's settings.

On every plan, CI and the dashboard show the break. A pull request's check
fails and the Action comments on it. The App's check on the commit says the
clip is broken. The summary of the job that publishes says what your pages
play meanwhile.

On Pro and Max, we also tell your team by email, in Slack or with a GitHub
issue, as the project's settings choose. We remind them two days after a clip
broke and then every week, until the clip passes again or someone
acknowledges it on the dashboard ("I know, keep the old one"). An
acknowledged clip gets one more reminder a month later if it is still
broken. When the clip passes again, we tell the team it is fixed.

### Who can see the clips

| Visibility | Who can see the clips |
|---|---|
| public | Anyone, and search engines. |
| unlisted | Anyone with the link. It is kept out of search. The link is made of names, so unlisted means not listed, not secret. |
| private | Whoever GitHub lets read the repository, signed in at app.version.cam. |

A private repository's clips start private, and a public repository's start
public. A private clip plays only for the people who may see it, so it never
plays on a public page. To show a private repository's clips in public docs or
on a landing page, make them public or unlisted in the project's settings.

### From the command line

`versioncam cloud` does what the dashboard does, from a terminal, and so
from an agent working in one:

```bash
npx versioncam cloud login              # a code you approve in a browser, once a week
npx versioncam cloud status             # this repository's clips: current or broken, and what plays
npx versioncam cloud failure checkout   # where a broken clip stopped, and the page as it was
```

**Signing in.** `cloud login` prints an address and a code. Open the address
on any device, sign in with GitHub, check that the page shows the same code,
and approve it. Nothing calls back to the machine that runs the command, so
it works over SSH and in a sandbox. The command line then keeps a token that
lasts seven days in `~/.config/versioncam/credentials.json`, or under
`$XDG_CONFIG_HOME` when that is set. Only you can read that file, and no
command prints it. On Windows, where file modes do not apply, it is as private
as the folder it is in, which by default is your user profile. `cloud logout`
revokes it. `VERSIONCAM_API`, set in the shell, points the commands at another
version.cam, and they keep a separate sign-in for each one. Unlike `publish`,
they never read `VERSIONCAM_API` or `XDG_CONFIG_HOME` from a `.env` file. That
way a repository you clone cannot point the commands at a server it chooses to
collect your sign-in, or make them write your token inside the repository.

**Reading** needs nothing more. `status` lists the clips: current or broken,
since when, who acknowledged a broken one, and the version your pages play
meanwhile. Then it shows the plan, and where to manage the project.
`failure <clip>` says which step stopped a broken clip and why, and saves the
page as it was then to `.versioncam/failures/<clip>.png`. `embed <clip>` prints
the snippets that embed it. `plan` says which plan, why and until when, what it
includes, and where to upgrade and pay. Each takes `--json`. They act on the repository
they run in, from its `origin` remote on GitHub, or on the one that
`--project owner/repo` names. `ack <clip>` is the dashboard's "I know, keep
the old one".

**A setting changes only once you approve it in the browser,** one change at
a time. `cloud set visibility public` prints the change in a sentence, an
address and a code, and waits up to ten minutes. The page shows exactly that
change, so an agent running the commands for you cannot change a project
without you seeing what it asked for. The settings are `visibility`,
`retention`, `viewers` ("Tell viewers when a clip is broken") and `alerts`,
by email, in Slack or with a GitHub issue.

You still do three things on app.version.cam: pay (`cloud plan` prints the
page), delete a project, and make a project token for CI outside GitHub.

The authoring skill runs these commands too: `/versioncam status`,
`/versioncam fix [clip]` and `/versioncam embed <clip>`.

### Other CI

A repository on GitHub publishes from GitHub Actions, even when another CI
service builds and tests it. GitHub's token says which repository, commit and branch a run
belongs to, and version.cam reads them from it. A project token,
`VERSIONCAM_TOKEN`, would have to state all that itself, with nothing to check
it against, so it works only for a project with no GitHub repository.

So when your CI runs elsewhere, run just the clips in GitHub Actions, in a
workflow beside the CI you have. In it, the versioncam Action checks the clips
on pull requests and publishes them from your default branch.
`npx versioncam ci` writes that workflow, and the
[Action's README](https://github.com/versioncam/action) has one to copy.

A repository outside GitHub publishes with a project token, given to
`versioncam publish` as `VERSIONCAM_TOKEN` and made on the project's page at
app.version.cam. We set up its project by hand, so write to hello@version.cam.

## What a recording leaves behind

`versioncam record` writes each clip to `.versioncam/recordings/<id>/`.

| File | What it holds |
|---|---|
| `timeline.json` | Everything the renderer needs, and everything a reviewer can check. |
| `states/` | The page states the timeline indexes, one image each. |
| `settles.json` | Every wait: what it was still blocked on, and how long it really took. |
| `targets.json` | Where each step's target was when the step began, by the step's index in `steps`: the box of the control it used. New in 0.3.0. |
| `failure.png` | Only after a failure: the page at the moment the clip gave up. |
| `failure-tools.png` | Only after a failure on a page with a dev server's own tools: the page a moment later, with them showing. |
| `failure.json` | Only after a failure: the message, the frame, the authored second, and the step that was running (its index in `steps` and its call; new in 0.3.0). |

The timeline's `frames` say which state each frame shows. Beside them are the
tracks the renderer applies: `cursor`, `pointer`, `camera`, `highlights` and
`captions`. A camera that follows the cursor, or eases from one move into
another, is stored as one key per frame. Three more fields are there for reading:

- **`marks`** are the clip's beats: one per labelled `settle()`, at the first
  frame that shows what the wait was for. `versioncam sheet --at-marks`
  samples those frames instead of eight even ones. That is the difference
  between a sheet that shows what the clip is about and one that happens to
  miss it.
- **`steps`** are the script's calls, in order, each with the frame it began
  on: `{ "frame": 212, "call": "typeInto" }`. There is one per line of the
  script. `typeInto` is one step, not also the click it makes, and a locator
  is an argument, not a step. A track write spends no time, so it shares a
  frame with the line after it. Steps are new in 0.1.3.
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

**Motion is modelled.** The driver uses minimum-jerk profiles, slight Bézier
arcs, Fitts-law durations and a dwell before each click. All of it is seeded, so it never
looks metronomic and never differs between runs.

**Rendering does not need the app running.** The page, the recording, the config and
your scenes are served from an in-memory route table. `versioncam render`
needs only a recording on disk and a browser.

**Output follows the viewport.** Record at 1440×900 and the video is 16:10.
For 16:9, record at 1600×900. Nothing is letterboxed or cropped. A portrait
viewport gives a portrait video, `output.width` high. A sequence stitches
clips of one size, so phone clips stay out of `sequence`. A backdrop, a
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
(default 30) covers them: the driver takes a screenshot at least that often,
whatever the gate says. A clip whose subject *is* a canvas
should set it to 1 and pay full price:

```ts
export default clip("03-the-map", { title: "The map", capture: { forceCaptureEvery: 1 } }, …);
```

**`--draft` for the loop.** A draft records fifteen frames a second, captured
at CSS scale instead of device scale, into the same place a full recording
goes.

```bash
npx versioncam record --draft 02-find-a-shipment   # then render and look
```

A draft does not change the page: same viewport, same device pixel ratio,
same layout, same code. If a draft lowered the DPR, it could pass while the
full recording fails on a media query that depends on the DPR. It does ignore a clip's own
`fps`, because the point is to be cheap. Its length can land up to 1/15 s from
the full capture's, so a draft is for looking at, not for comparing against.

`versioncam record` prints where the time went. That tells you whether to
save time in the frames or in the other parts, which are opening the page, the
waits, and writing the files:

```
  01-create-a-shipment: 425 frames, 63 states, 1 cut · plays 7.1s · took 6.3s
    open 0.0s · settles 0.5s · frames 5.7s (79 captured, 346 skipped) · write 0.0s
```

`plays` is the clip's own length and `took` is what the machine spent making
it. When a clip gets slower to record, `took` can go up while `plays` goes
down, which is why the line names both.

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
recordings at most. Then the session makes a contact sheet sampled *at the
beats* and hands it to a fresh reviewer.

**The reviewer** is `versioncam-reviewer`, new every round. It sees the
picture, the beats and a five-item checklist, and nothing of how the clip was
written: a reviewer that has read the author's reasoning agrees with it. Its
verdict comes back as fixes to make, and the round repeats. After six rounds
at most it stops and says why. On a host that cannot register the reviewer as
an agent, the same file is a subagent's prompt. On a host with no subagents at
all, it is a checklist the session applies to its own sheet. The verdict
records which of the three kinds of reviewer judged the clip.

**What you get** is under `.versioncam/author/<id>/`: the beat sheet, a
`summary.json`, the final sheet, and for each round what the author found,
its beats and the reviewer's verdict. The clip itself goes in your clips
directory. That is the part worth reading and committing.

**What it costs.** A clip on the example app takes six to twelve minutes and
one or two rounds, most of it model latency rather than the recorder. It is not
cheap or instant, but it runs unattended.

**What it is not.** The skill cannot sign your app in for you. It asks how you
want that handled, and `versioncam login` is yours to run because it waits
for you. It does not run `git`. And `versioncam review` only checks what
needs no eyes. Whether the clip is *good* is the reviewer's job, and after
that, yours.

## Determinism

Two runs of a clip on one machine produce the same bytes, draft and full. The
package's own tests assert it for capture and for rendering on every change,
on macOS and on Linux. The tests also record a fixture again and compare it
with a committed golden recording, so a change to cursor planning or frame
timing that nobody meant to make fails them.

A render is the same bytes every time it is made from one recording, on one
ffmpeg build, with one encoder thread count. The thread count otherwise
follows the machine's cores, so a render that must match another machine's
fixes it with `output.threads` or `VERSIONCAM_FFMPEG_THREADS`. Before 0.3.0
every WebM carried a random id and no two were the same file.

Across machines the claim is narrower. The **timeline** is identical: it is
what the driver decided, and nothing in it depends on the host. The captured
**pixels** are identical only where the rendering environment is. macOS, Linux
and Windows rasterise text differently. The same page in the same state looks
the same on each, but the image files differ byte for byte. Identical bytes need a fixed
environment. In CI that means one runner image, and the Playwright container
for the version versioncam pins is the simplest (see *In CI*).

If two recordings of your clip on one machine differ, something outside the
authored clock reached a frame: an unwarmed resource, a real timer, a font
that had not finished loading. Find the cause. *When a clip will not
reproduce* below says how.

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
  clip's start, not from when the animation starts. So a one-off animation
  that starts partway through a clip is already past its duration when it
  appears, and the video shows only its end. Once a one-off animation's time is
  up it finishes, as in a browser nobody is filming: its `finished` promise
  resolves and `animationend` fires. So a dialog that your app removes after its exit
  animation goes away, rather than sitting invisibly over the page.
- **Smooth scrolling is instant.** A stylesheet's `scroll-behavior: smooth`
  and a script's `{ behavior: "smooth" }` both scroll at once, since the
  browser would animate either on a clock the recorder does not move. A chat
  that keeps its newest message in view jumps to it. To film a scroll, use
  `s.scroll`.
- **Not on the clock:** animations a script makes with `element.animate()`,
  Chromium's smooth scrolling of a mouse wheel, and transitions inside an
  iframe, which stay zeroed since nothing drives an iframe's clock. A clip
  that films one of the first two may differ between runs: `stability` says
  so.

### Live data

Map tiles, a model's answer, a job's status and a count that grows all come
from a server. The server answers at its own speed and with that day's data.
So if a clip shows one of them, two recordings of the clip differ wherever that
data reaches the page.
`replay` records those responses the first time a clip runs and serves them,
from a file, on every run after:

```ts
replay: {
  record: ["https://tiles.example.com/**", "**/api/chat/**"],
  // A stream the page reads over time, one event every 300 ms of the clip.
  pace: [{ url: "**/api/chat/*/stream", chunkMs: 300 }],
},
```

| Field | Default | What it sets |
|---|---|---|
| `record` | required | The requests to record and replay: URL globs, as Playwright writes them, or regular expressions. |
| `mode` | `"auto"` | `"auto"` replays a clip whose file exists and records one whose file does not. `"record"` always records, `"replay"` fails without a file, `"live"` ignores it. `--replay <mode>` on `record` and `stability` overrides it for one run. |
| `dir` | `"replay"` | Where the files go, beside the config. Commit them: a replay is an input, like a fixture, and CI needs it to record the clip the same way. |
| `pace` | none | Responses the page reads a piece at a time, an event stream or lines of JSON: delivered one event or one line every `chunkMs` of the page's clock, so each piece lands on the same frame every run, at any frame rate. |
| `redact` | none | Query parameters left out of the file, and of the match, by name. |
| `onMissing` | `"fail"` | A request that matches `record` but has no answer in the replay file fails the clip, naming it, since a request that quietly went live is what this exists to stop. `"live"` sends it to the network with a warning instead. |

Each clip has its own file, `replay/<clip>.har`, a HAR that a browser's
developer tools can open. Text bodies are in it, where a diff can read them;
binary ones, tiles and images, sit beside it under `replay/bodies/`, named by
their hash, so clips that load the same tiles keep them once. The
`Authorization`, `Cookie`, `Set-Cookie` and `X-API-Key` headers are never
written. The bodies are written as the server sent them, so read a replay
before committing it if the server's answers can hold anything private.

Some requests go to the same URL several times, such as a job's status polled
until it is done. The replay answers them in the order it recorded them, and
gives the last answer again after that. A request the clip answers itself, with `page.route` from
`offCamera`, never reaches the replay, so a hand-written mock still wins
where a clip has one. The frame loop waits for the replay's answers, so a
response arrives in the frame it was asked for on every run.

`doctor` lists each clip's replay, how many requests it holds and when it
was recorded, and `check` points out a replay older than ninety days. It goes
by age alone. A clip that passes against its replay proves that the app still
makes the same requests. It does not prove that the server still answers them
the same way. When
the app changes what it fetches, the clip fails and names the request; record
it again with `versioncam record <id> --replay record`.

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
at the app first, but not only there. Of the six causes we have found so far,
four were bugs in the recorder. Here are the six:

- A **dev server's own tools**, drawn over the app on a clock of their own. The
  recorder hides the ones it knows (see below), and any other is the first thing
  to look for when frame 0 differs.
- An **autosizing text field** that settles a frame later depending on how the
  browser scheduled the layout. The clips that typed into it differed between
  runs, and the clips that did not type stayed identical.
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
- A **hover under a scroll**, the recorder's fault and since fixed. A heading
  passed under a resting cursor, and Chromium decides `:hover` after a scroll on
  a timer of its own, so the heading's hover fade began a frame earlier in one
  run than the other. The driver now tells it where the mouse is on every step
  of a scroll.

If the two recordings match each other but not another recording of the same
clip, ask what changed between them: the gate (`capture: { gate: false }` turns it off), or the
machine.

A draft can differ where a full recording does not. It paints the page a second
time at half the scale, and on a glyph that is fading the edge pixels of that
paint can vary, too little to see. If the two pictures look the same, run
`stability --full`: that is the recording that renders.

### A dev server's own tools

`next dev`, `nuxt dev` and `astro dev` draw a badge or a toolbar of their own over
the app. It is not part of the product, but it would be in the video, usually
under the caption. It also runs on a clock of its own, so it appears at a
different moment on each run, and `stability` fails at frame 0. The recorder hides these three by itself, and no setting is
needed.

Next's error dialog is in the same element as its badge, so it is hidden too, and
the recorder shows errors another way. `record` and `check` print whatever the
page throws. For a clip that carries on, they print it as it happens. For a clip
that fails, they print it beside the failure.
A failed clip also leaves `failure-tools.png` beside `failure.png`, with the tools
showing. That is where you find Next's build error. Hiding the tools never hides
a failure: a video of a broken page still shows the broken page.

Any other tool stays, such as a debug toolbar or a query inspector, and it is the
first thing to look for when frame 0 differs. Turn it off in its own config. To keep
it for your own work, read a variable there (`enabled: !process.env.RECORDING`) and
set it for the recorder with `webServer: { env: { RECORDING: "1" } }`. The recorder
reuses a server that is already running as it is, so stop yours first. Or record a
production build,
`webServer: { command: "npm run build && npm start" }`, which has no dev tools at
all, and no reloads either.

A clip about one of the three can bring it back, for the page it is on:

```ts
await s.offCamera((page) =>
  page.evaluate(() => document.getElementById("__recorder_dev_tools")?.remove()),
);
```

## While recording

Do not edit files. A dev server pushes a full page reload to every connected
client, including the page being recorded. The driver detects it and says so,
but the run is lost either way. The same goes for an app that reloads itself on
purpose once a clip is under way. The recorder films a link or a form post, but
not a reload. An app that reloads itself as it opens loses nothing, and frame 0
shows the page that stayed.

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
| render | Drawing the cursor, highlights and captions over a recording, applying the camera's zoom and pan, and encoding the video. |
| reviewer | The fresh agent that judges a contact sheet against the beats and a five-item checklist. |
| scene | A designed panel: frames drawn in code rather than captured from the app. |
| settle | A wait that advances the page's clock but captures nothing, so it never reaches the video. |
| stable | Two recordings of a clip, made the same way on one machine, are identical. |
| step | One line of the script, as the timeline's `steps` records it. |
| timeline | `timeline.json`: which state each frame shows, and every track drawn over it. |
| track write | A call to `camera`, `highlight` or `caption`. It writes at the current instant and spends no time. |

## Help

Bugs, questions, and apps it cannot record go to the issue tracker at
[github.com/versioncam/versioncam](https://github.com/versioncam/versioncam/issues),
where the source is.
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
