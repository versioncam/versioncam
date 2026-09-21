# @living-demos/recorder

Record demo clips of a real web app: scripted, deterministic, regenerated on
deploy.

A clip is a script in your repository. It drives the shipped UI through its own
controls, captures it, composites a cursor and a camera over the result, and
encodes it. Run it again after every deploy. When the UI changes in a way the
clip depends on, the clip *fails* — naming the control it could not find and
the second it gave up — instead of quietly producing a video that is wrong.

## Install

```bash
npm i -D @living-demos/recorder
npx playwright install chromium
npx demos doctor          # checks node, chromium, ffmpeg, and your config
```

ffmpeg and ffprobe come from the system (`brew install ffmpeg`,
`apt install ffmpeg`). The optional `ffmpeg-static` covers images that have
neither, but it does not include ffprobe.

## Configure

`recorder.config.ts`, beside your clips:

```ts
import { defineRecorder } from "@living-demos/recorder";

export default defineRecorder({
  baseUrl: process.env.DEMOS_BASE_URL ?? "http://localhost:5173",
  viewport: { width: 1440, height: 900 },
  clips: "demos/clips/**/*.clip.ts",

  // Either a saved browser session…
  auth: { storageState: ".demos/auth.json" },
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
import { clip } from "@living-demos/recorder";

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

Target elements by role or test id, never by coordinates. Strokes (`s.lasso`,
`s.drag`) are authored in fractions of a target's box for the same reason: a
clip built from locators survives a layout change.

**Look before you write.** Clips written from an app's source reach for
controls that are conditional, renamed, or not rendered at all:

```bash
npx demos inspect /shipments          # what is on the page and what it is called
npx demos measure / '.marker'         # where the matches are, as fractions
```

## Commands

```
demos record [id…]            drive the app and capture frames
demos render [id…]            composite and encode
    --scene <id>                render a designed scene
    --sequence                  stitch the results into one piece
demos check [id…]             record everything; non-zero if any clip breaks
demos sheet <id>              an eight-frame contact sheet
demos preview <id>            open the scrubber in a real browser
demos inspect <path>          what a clip can click
demos measure <path> <sel>    where the matches of a selector are
demos login                   sign in once and save the session
demos doctor                  check this machine can record and encode
```

`demos check` is the CI command. It does not render: a demo that no longer
matches the app fails while being recorded, at the step that no longer exists,
and encoding a video of the wreckage helps nobody.

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
your scenes are served from an in-memory route table, so `demos render` works
from a recording on disk and a browser.

**Output follows the viewport.** Record at 1440×900 and the video is 16:10;
want 16:9, record at 1600×900. Nothing is letterboxed or cropped. A backdrop,
device frame and padding are available via `theme.presentation`, off by
default.

## Determinism

Two runs of a clip produce the same bytes. The package's own tests assert it
both for capture and for rendering, and a golden-file check pins the capture
path against unintended change.

Regenerate that baseline deliberately, never reflexively:

```bash
UPDATE_FIXTURE=1 npm run test:integration -w @living-demos/recorder
```

If a byte-identity test fails, something outside the authored clock leaked
into a frame — an unwarmed resource, a real timer, a font that had not
finished loading. Fix the cause, not the assertion.

## While recording

Do not edit files. A dev server pushes a full page reload to every connected
client, including the page being recorded. The driver detects it and says so,
but the run is lost either way.

Record one clip at a time against a given app session. The CLI already does;
the thing to avoid is leaving a browser tab open on the same session.
