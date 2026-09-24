# versioncam

Record demo clips of a real web app: scripted, deterministic, regenerated on
deploy.

A clip is a script in your repository. It drives the shipped UI through its own
controls, captures it, composites a cursor and a camera over the result, and
encodes it. Run it again after every deploy. When the UI changes in a way the
clip depends on, the clip *fails* — naming the control it could not find and
the second it gave up — instead of quietly producing a video that is wrong.

## Install

This package is not published yet — it is `private: true` and on no registry —
so a consumer installs it from the checkout:

```bash
# once, in this repository
npm --prefix packages/recorder link

# then in the app that wants clips
npm link versioncam
npx playwright install chromium
npx versioncam doctor          # node, chromium, ffmpeg, your config, and the app
```

A `file:` dependency works too and survives `npm ci`, which a link does not:

```jsonc
// package.json in the app
{ "devDependencies": { "versioncam": "file:../versioncam/packages/recorder" } }
```

Publishing is a decision rather than a task: drop `private`, pick a registry,
and for a private one wire an auth token into CI. Until then a link or a
`file:` path is the whole story, and both work.

ffmpeg and ffprobe come from the system (`brew install ffmpeg`,
`apt install ffmpeg`). The optional `ffmpeg-static` covers images that have
neither, but it does not include ffprobe.

## Configure

`versioncam.config.ts`, beside your clips:

```ts
import { defineRecorder } from "versioncam";

export default defineRecorder({
  baseUrl: process.env.DEMOS_BASE_URL ?? "http://localhost:5173",
  viewport: { width: 1440, height: 900 },
  clips: "demos/clips/**/*.clip.ts",

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

## Commands

```
versioncam record [id…]            drive the app and capture frames
    --draft                        15fps at CSS scale: cheap, for writing clips
versioncam render [id…]            composite and encode
    --scene <id>                   render a designed scene
    --sequence                     stitch the results into one piece
versioncam check [id…]             record everything; non-zero if any clip breaks
versioncam sheet <id>              an eight-frame contact sheet
    --at-marks                     sample the beats instead of even spacing
versioncam frame <id> <n>          one frame at output size, to a png
    --t <seconds>                  pick the frame by time instead
versioncam preview <id>            open the scrubber in a real browser
versioncam review <id>             the checks that need no eyes; PASS/FAIL, exit 0/1
    --beats <file>                 [{ label, expect }] the clip promised
    --min <s> --max <s>            duration bounds (default 9–11)
versioncam inspect <path>          what a clip can click
versioncam measure <path> <sel>    where the matches of a selector are
versioncam dsl                     the clip DSL, every method, one line each
versioncam login                   sign in once and save the session
versioncam doctor                  check this machine can record, and the app is up
versioncam init --claude           copy the authoring skill and agents into .claude/
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
look at what you got, fix. `versioncam` ships that loop as a Claude
Code plugin — a skill that orchestrates it and two agents that do the work.
There is no API key and no SDK: the model is whichever Claude Code session runs
the skill, and it reads contact sheets with the same tool it reads files with.

```bash
npx versioncam init --claude          # copy the skill and agents into .claude/
# or, without copying anything:
claude --plugin-dir node_modules/versioncam/plugin
```

Then, with the app running:

```
/versioncam "Find a shipment by filtering the list, and show how many matched"
```

**What happens.** The skill checks the app is up, inspects the start page, and
hands that to a `demo-author` agent along with the intent. The author reads
`versioncam dsl` and your existing clips, writes a beat sheet, writes the clip, and
records it in draft until `versioncam review` passes. The skill then renders a
contact sheet sampled *at the beats* and spawns a `demo-reviewer` — a fresh one
every round, which sees the picture, the beats and a five-item checklist, and
nothing of how the clip was written. A reviewer that has read the author's
reasoning agrees with it. Its verdict goes back to the same author, which keeps
what it learned about the page. Six rounds at most, then it stops and says why.

**What you get**, under `.versioncam/author/<id>/`: the beat sheet, a `summary.json`,
the final sheet, and per round the author's report, its beats and the reviewer's
verdict. The clip itself goes in your clips directory, which is the part worth
reading and committing.

**What it costs.** About fifteen minutes and four recordings for one clip, most
of it model latency rather than the recorder. It is not cheap and it is not
instant; it is, however, unattended.

**What it is not.** The author cannot sign your app in — if `open()` lands on a
sign-in screen it stops and says so, because that is `auth` in your config and
`versioncam login` is interactive. It does not run `git`. And `versioncam review` only
checks what needs no eyes: duration, that every beat left a mark, that each beat
changed the screen, that nothing was written after the last frame. Whether the
clip is *good* is the reviewer's job, and after that, yours.

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

Before assuming it is one, record the clip twice the same way:

```bash
npx versioncam record 02-find-a-shipment && cp -r .versioncam/recordings/02-find-a-shipment /tmp/a
npx versioncam record 02-find-a-shipment && diff -r /tmp/a .versioncam/recordings/02-find-a-shipment
```

If those two differ, nothing about the recorder is implicated yet — something
in the app does not depend on authored time. What we have found doing this:

- An **autosizing text field** that settles a frame later depending on how the
  browser scheduled the layout. The clips that typed diverged; the clips that
  did not, did not.
- A **spinner**, via the recorder's own fault, since fixed: the screenshot was
  cancelling the animation the driver had just scrubbed. Worth knowing because
  the symptom was six pixels in one frame of three hundred, which reads as
  noise rather than as a bug.

If the two recordings match and something else does not, the next question is
what changed between them — the gate (`capture: { gate: false }` turns it off)
or the machine.

## While recording

Do not edit files. A dev server pushes a full page reload to every connected
client, including the page being recorded. The driver detects it and says so,
but the run is lost either way.

Record one clip at a time against a given app session. The CLI already does;
the thing to avoid is leaving a browser tab open on the same session.
