# versioncam

Record demo clips of a real web app: scripted, deterministic, regenerated on
deploy.

A clip is a script in your repository. It drives the shipped UI through its own
controls, captures it, composites a cursor and a camera over the result, and
encodes it. Run it again after every deploy. When the UI changes in a way the
clip depends on, the clip *fails* — naming the control it could not find and
the second it gave up — instead of quietly producing a video that is wrong.

## Install

Three commands, then a sentence:

```bash
npm i -D versioncam
npx versioncam install       # the Chromium this version records with
npx versioncam init          # installs the authoring skill into .claude/
```

```
/versioncam "Show a user filtering the list down to one shipment"
```

The first run of the skill sets the repository up: it writes
`versioncam.config.ts` from what it finds, proves the app starts and records
the same way twice, and only then writes the clip. See *Authoring*.

`npx versioncam doctor` checks the rest — Node 22 or later, Chromium, ffmpeg,
your config, and whether the app starts. ffmpeg and ffprobe come from the
system (`brew install ffmpeg`, `apt install ffmpeg`); the optional
`ffmpeg-static` covers images that have neither, but it does not include
ffprobe. It is tested on macOS and Linux; Windows is untested.

`install` rather than `npx playwright install`, because versioncam pins its
Playwright exactly — a new Chromium changes every captured pixel — and your
app may have a Playwright of its own, at another version, whose Chromium is
the one `npx playwright install` fetches.

### In CI

The same install, then `check`, which records every clip and fails the job on
the first one that no longer matches the app:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
- run: npx versioncam install --with-deps
- run: npx versioncam check
```

`check` records and does not render, so it needs no ffmpeg; a job that also
runs `render` adds `sudo apt-get install -y ffmpeg`. Two runs on one runner
image produce the same bytes. To pin everything the pixels depend on — the
browser build, the fonts, the system libraries — run the job in the Playwright
image for the version versioncam pins, `mcr.microsoft.com/playwright:v1.59.1-noble`,
where Chromium and its libraries are already installed.

## Configure

`versioncam.config.ts`, beside your clips:

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

Everything app-specific goes through this object. If the recorder needs to know
something about your app that this cannot express, that is a missing field, not
a reason to fork.

**The app starts itself.** `webServer` is Playwright's, field for field:
`command`, `url` (default `baseUrl`), `cwd` (default the config's directory),
`timeoutMs` (default two minutes), `reuseExistingServer`, `env`. Every command
that drives the app — `record`, `check`, `stability`, `inspect`, `measure`,
`login`, `doctor` — first asks `url` whether anything is serving. Any answer
counts, a 401 included, and a server that answers is used as it is and left
running afterwards; with `CI` set it is refused instead, because on a runner a
server that was up before the job started is not the build under test
(`reuseExistingServer: true` allows it). Silence means the command starts
`command` through a shell, with the shell's environment plus `env` — not what
the recorder loaded from `.env.recording` for itself — waits for an answer,
and writes what it prints to `.versioncam/webserver.log`. Whatever it started,
it stops when it finishes — normally, on an error, or on Ctrl-C — by
signalling the command's whole process group: SIGTERM, five seconds' grace,
then SIGKILL, and the log says which it took. Something the start command
hands off to outside that group, such as a container runtime, is out of its
reach — the command warns when the port still answers after the stop — and so
is worth starting yourself. So is any stack with a slow cold start: every
command reuses what is already running.

For a stack of several services, point `url` at the one that is ready last,
not at the page: a dev server answers seconds before the API behind it, and a
clip that opens then meets a sign-in form with nothing to sign in to.

## Write a clip

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

Every `await` advances the clip's time and captures as it goes. `s.camera.*`,
`s.highlight` and `s.caption` write to tracks at the current instant and cost
no time. `s.offCamera(page => …)` runs raw Playwright with nothing captured —
for setup that should not appear, such as mocking an API.

Target elements by role or test id, never by coordinates. Strokes (`s.drag`
for a straight one, `s.lasso` for a closed loop) are authored in fractions of a
target's box for the same reason: a clip built from locators survives a layout
change.

`npx versioncam dsl` prints the whole surface, generated from the code, and a test
asserts that list and the session agree. That is worth more than it sounds:
this README promised an `s.drag` for months while there was none, and a clip
that needed one clicked instead — on a d3 brush, where a click sets a selection
of zero width and so *clears* the filter. It recorded cleanly and showed
nothing, for months, and no check caught it.

**Look before you write.** Clips written from an app's source reach for
controls that are conditional, renamed, or not rendered at all:

```bash
npx versioncam inspect /shipments          # what is on the page and what it is called
npx versioncam measure / '.marker'         # where the matches are, as fractions
```

`inspect` says where each name came from — `[aria-label]`, `[label]`,
`[placeholder]`, `[text]` or `[name]` — because that decides the locator:
`byLabel` finds the first two and not a placeholder, which `byPlaceholder`
finds instead. `measure` prints what each match says, so a beat's `expect`
can quote the status line it is waiting for rather than guess at it.

## Commands

```
versioncam record [id…]            drive the app and capture frames
    --draft                        15fps at CSS scale: cheap, for writing clips
versioncam render [id…]            composite and encode
    --scene <id>                   render a designed scene
    --sequence                     stitch the results into one piece
versioncam check [id…]             record everything; non-zero if any clip breaks
versioncam stability [id…]         record each clip twice the same way; stable or not
    --runs <n>                     how many times (default 2)
    --full                         at full quality rather than draft
versioncam sheet <id>              an eight-frame contact sheet
    --at-marks                     sample the beats instead of even spacing
versioncam frame <id> <n>          one frame at output size, to a png
    --t <seconds>                  pick the frame by time instead
    --at <label>                   or by the beat it shows
versioncam preview <id>            open the scrubber in a real browser
versioncam review <id>             the checks that need no eyes; PASS/FAIL, exit 0/1
    --beats <file>                 [{ label, expect }] the clip promised
    --min <s> --max <s>            duration bounds (default 9–11)
versioncam inspect <path>          what a clip can click, and where each name came from
versioncam measure <path> <sel>    where the matches of a selector are, and what they say
versioncam dsl                     the clip DSL, every method, one line each
versioncam login                   sign in once and save the session
versioncam doctor                  check this machine can record, and that the app starts
versioncam install                 the Chromium this version of versioncam records with
    --with-deps                    and its system libraries (Linux CI)
versioncam init                    install the authoring skill into .claude/
    --into <dir>                   into <dir>/versioncam/ instead, for another host
    --force                        overwrite files that are already there
```

`versioncam check` is the CI command. It does not render: a demo that no longer
matches the app fails while being recorded, at the step that no longer exists,
and encoding a video of the wreckage helps nobody.

## What a recording leaves behind

In `.versioncam/recordings/<id>/`: `timeline.json`, the `states/` it indexes, and
`settles.json` — every wait, what it was still blocked on, and how long it
really took. A clip that fails also leaves `failure.png`, the page at the
moment it gave up, and `failure.json` with the message, the frame and the
authored second.

The timeline's `marks` are the clip's beats: one per labelled `settle()`, at
the first frame that shows what the wait was for. `versioncam sheet --at-marks`
samples those frames instead of eight even ones, which is the difference
between a sheet that shows what the clip is about and one that happens to miss
it.

`versioncam review <id> --beats beats.json` is the half of reviewing a clip that
needs no eyes, and no browser: is it the right length, did a wait give up, does
every beat in the sheet have a mark, did the screen actually change between one
beat and the next, and did the clip end on a camera move with no frames left to
show it. It prints a line per clause and exits 0 or 1. What needs eyes — is
this legible, is the cursor in the way, does the frame show what the beat
claimed — is what the contact sheet and `versioncam frame` are for.

## How it works

**Time is authored, not measured.** The script declares the timeline; the
driver steps the app through it one output frame at a time, advancing the
page's fake clock by exactly 1/fps and capturing. Anything slow — a query, a
tile, a model — happens inside a `settle()` that advances the clock but
captures nothing, so it never reaches the video.

**The cursor is real input with a synthetic glyph.** Headless Chrome draws no
pointer, so the driver moves the *real* mouse along a planned path — hover and
press states genuinely fire in the captured frames — and records that path as
data. The glyph, the press and the ripple are drawn afterwards at output
resolution, which means the look can change without re-recording.

**Motion is modelled.** Minimum-jerk profiles, slight Bézier arcs, Fitts-law
durations, a dwell before each click, all seeded — so it never looks
metronomic and never differs between runs.

**Rendering needs nothing running.** The page, the recording, the config and
your scenes are served from an in-memory route table, so `versioncam render` works
from a recording on disk and a browser.

**Output follows the viewport.** Record at 1440×900 and the video is 16:10;
want 16:9, record at 1600×900. Nothing is letterboxed or cropped. A backdrop,
device frame and padding are available via `theme.presentation`, off by
default.

## Speed

Writing a clip means running it, looking at it, and changing a line — so what
matters is how long that loop takes.

**Most frames are not photographed.** A clip is mostly frames in which nothing
moved, and the screenshot is by far the most expensive thing a frame does: 25 ms
against half a millisecond for everything else. So the driver takes one only
when the page can have changed — the DOM mutated, the element under the cursor
changed, an animation is running, input was just sent, or `forceCaptureEvery`
frames have gone by. On the example app that skips 81% to 95% of frames, and
the recording is identical either way. A test records every clip both ways on
every push and compares the bytes, because the failure mode is not a crash but
a video that is quietly wrong.

The one thing it cannot see is a surface that redraws itself: a canvas, a WebGL
view, a video. None of them touches the DOM. `capture.forceCaptureEvery`
(default 30) is the floor under that; a clip whose subject *is* a canvas should
set it to 1 and pay full price:

```ts
export default clip("03-the-map", { title: "The map", capture: { forceCaptureEvery: 1 } }, …);
```

**`--draft` for the loop.** Fifteen frames a second, captured at CSS scale
instead of device scale, into the same place a real recording goes.

```bash
npx versioncam record --draft 02-find-a-shipment   # then render and look
```

It deliberately does not change the page: same viewport, same device pixel
ratio, same layout, same code. A draft that reduced the DPR could pass while
the capture it stands in for fails on a media query. It does ignore a clip's
own `fps`, because the point is to be cheap. Its duration can land up to 1/15 s
from the full capture's, so a draft is for looking at, not for comparing
against.

`versioncam record` prints where the time went, which is how you tell whether the
next second would come from the frames or from somewhere else:

```
  01-create-a-shipment: 425 frames, 63 states, 1 cuts — plays 7.1s · took 6.3s
    open 0.0s · settles 0.5s · frames 5.7s (79 captured, 346 skipped) · write 0.0s
```

`plays` is the clip's own length and `took` is what the machine spent making
it. They move in opposite directions when a clip gets slower to record, which
is why both are named.

## Authoring

A clip is a script, and writing one is a loop: look at the page, write, record,
look at what you got, fix. `versioncam` ships that loop as one agent skill.
There is no API key and no SDK: the model is whichever agent session runs the
skill, and it reads contact sheets with the same tool it reads files with.

```bash
npx versioncam init          # .claude/skills/versioncam/ and .claude/agents/versioncam-reviewer.md
# or, for Claude Code without copying anything:
claude --plugin-dir node_modules/versioncam/plugin
```

`init --into <dir>` puts the skill directory somewhere else, for a host that
reads skills from elsewhere. Then:

```
/versioncam "Find a shipment by filtering the list, and show how many matched"
```

**The first run** — in a directory with no `versioncam.config.ts` — sets the
repository up before anything else: how the app starts and where it is served,
from its scripts and its framework's config; whether it signs in, which it
asks you about; a config with a `webServer`, so nothing has to be running;
`doctor` and `inspect` to prove the app starts and settles; and `stability`
on a three-second clip, so no clip is written against an app that does not
record the same way twice. It commits nothing.

**Every run.** The session inspects the start page and writes the clip itself:
it reads `versioncam dsl` and your existing clips, writes a beat sheet, writes
the clip, and records it in draft until `versioncam review` passes, three
recordings at most. Then a contact sheet sampled *at the beats*, and a fresh
reviewer every round — `versioncam-reviewer`, which sees the picture, the
beats and a five-item checklist, and nothing of how the clip was written. A
reviewer that has read the author's reasoning agrees with it. Its verdict comes
back as fixes to make, and the round repeats; six rounds at most, then it stops
and says why. On a host that cannot register the reviewer as an agent, the same
file is a subagent's prompt, or — with no subagents at all — a checklist the
session applies to its own sheet, and the verdict says which.

**What you get**, under `.versioncam/author/<id>/`: the beat sheet, a
`summary.json`, the final sheet, and per round what the author found, its
beats and the reviewer's verdict. The clip itself goes in your clips
directory, which is the part worth reading and committing.

**What it costs.** Six to twelve minutes and one or two rounds for a clip on
the example app, most of it model latency rather than the recorder. It is not
cheap and it is not instant; it is, however, unattended.

**What it is not.** The skill cannot sign your app in for you — it asks how
you want that handled, and `versioncam login` is yours to run because it waits
for you. It does not run `git`. And `versioncam review` only checks what needs
no eyes: duration, that every beat left a mark, that each beat changed the
screen, that nothing was written after the last frame. Whether the clip is
*good* is the reviewer's job, and after that, yours.

## Determinism

Two runs of a clip on one machine produce the same bytes. The package's own
tests assert it for capture and for rendering, and a golden-file check pins the
capture path against unintended change.

Across machines the claim is narrower, and worth stating precisely: the
**timeline** is identical — it is what the driver decided, and nothing in it
depends on the host. The captured **pixels** are not, because macOS and Linux
rasterise text differently, so the same page in the same state is the same
picture and a different file. Byte-identity is a property of a fixed rendering
environment; the golden-file check compares bytes only on the platform its
baseline was recorded on, and compares the timeline everywhere.

Regenerate that baseline deliberately, never reflexively:

```bash
UPDATE_FIXTURE=1 npm run test:integration -w versioncam
```

If a byte-identity test fails, something outside the authored clock leaked
into a frame — an unwarmed resource, a real timer, a font that had not
finished loading. Fix the cause, not the assertion.

### When a clip will not reproduce

The recorder can only be as deterministic as the app it is filming, and an app
that is *nearly* deterministic is the hard case: it reproduces most runs, so the
first failure looks like a recorder bug.

Before assuming it is one, record the clip twice the same way — which is
what `stability` does, frame by frame, by what each frame shows:

```bash
npx versioncam stability 02-find-a-shipment          # draft; --full for the real thing
```

```
02-find-a-shipment: run 1 vs run 2 — 268 frames, 264 identical, first difference at frame 131
  .versioncam/stability/02-find-a-shipment/frame-131-run1.png
  .versioncam/stability/02-find-a-shipment/frame-131-run2.png
unstable — something on this page does not run on authored time
```

The two files are the pictures behind the first frame that differs; what
differs is usually obvious once they are side by side. Each run records beside
the clip's own recording, under `recordings/__stability/`, never over it. With
no id it checks every clip, and it exits 0 only when every pair matched —
which makes it the first thing to run in a repository before writing a clip
for it, and what the authoring skill does on a first run.

If the runs differ, nothing about the recorder is implicated yet — something
in the app does not depend on authored time. What we have found doing this:

- An **autosizing text field** that settles a frame later depending on how the
  browser scheduled the layout. The clips that typed diverged; the clips that
  did not, did not.
- A **spinner**, via the recorder's own fault, since fixed: the screenshot was
  cancelling the animation the driver had just scrubbed. Worth knowing because
  the symptom was six pixels in one frame of three hundred, which reads as
  noise rather than as a bug.
- A **typed letter's edge**, via the recorder's own fault, since fixed: a
  draft's screenshot has Chromium paint the page again at CSS scale, and it
  repainted only the rectangle the page reported as changed, which at that
  scale could stop a pixel short of a new glyph's antialiased edge. Only on
  Linux, where text has LCD antialiasing: one pixel of one frame, in about half
  of all runs. Side by side the two pictures look identical; subtracting one
  from the other finds it.
- A **timer firing early**, via the recorder's own fault, since fixed: the
  page's fake clock was installed but left running on real time between
  frames, so a slow screenshot reached the page as time. One stalled frame on
  a CI runner moved the clock 840 ms instead of 67 and the example app's
  shipment appeared seven frames early. The clock is paused now and moves only
  when the driver moves it.

If the two recordings match and something else does not, the next question is
what changed between them — the gate (`capture: { gate: false }` turns it off)
or the machine.

## While recording

Do not edit files. A dev server pushes a full page reload to every connected
client, including the page being recorded. The driver detects it and says so,
but the run is lost either way.

Record one clip at a time against a given app session. The CLI already does;
the thing to avoid is leaving a browser tab open on the same session.

## Licence

Versioncam is under the Functional Source License, version 1.1, with Apache
2.0 as its future licence (`FSL-1.1-ALv2`). Use it on your own apps and in your
own CI, commercial work included, and change it as you need; what the licence
does not allow is making it available to others in a product or service that
competes with it. Two years after each version is released, that version is
also available under Apache 2.0. This is a summary; `LICENSE.md` is the
licence.
