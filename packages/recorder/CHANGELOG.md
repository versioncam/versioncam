# Changelog

What a user of `versioncam` would want to know about each version, newest
first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [semantic versioning](https://semver.org/). While the
major version is 0, a minor version may change the config or the clip DSL,
and its entry here says how.

## 0.1.3 (2026-09-28)

### Added

- A recording lists the steps its script took: `steps` in `timeline.json`,
  each DSL call the script made and the frame it began on. There is one per
  line of the script: `typeInto` is one step, not also the click it makes, and
  a locator is an argument, not a step. A reader holding the script can say
  which line produced which moment.
- A recording names the versioncam that made it: `meta.recorder`, the package
  version. A page that shows the recording can print the version that
  recorded it instead of the latest release.

### Changed

- The DSL reference gives every method its own heading and every option its
  default, and `versioncam dsl` prints it. It used to say `camera.zoom`
  defaults to 1.65. The default is 1.5, as far as the camera goes before
  captured pixels are upscaled.
- `versioncam --help` groups the commands by stage: set up, write, record,
  review, output.
- The CLI's messages say things in sentences and brackets rather than
  dashes. `record` says "1 cut" rather than "1 cuts". `stability` separates
  the pair it compared from the result with a `·`, so a script matching its
  output needs the new line.

## 0.1.2 (2026-09-28)

### Fixed

- Typing followed straight away by another action no longer loses its last
  character. `type` and `typeInto` queue keystrokes at a human cadence.
  Whenever the typing ended between two frames, the last keystroke stayed
  queued until after the next step. So `typeInto(…)` then `press("Enter")`
  sent the text without its last character, which then began the next
  message. Whether a clip was affected depended only on its timing.
- A point written as `{ x, y }`, the shape a bounding box gives you, fails
  with "A point is [x, y], not { x, y }", which names the fix. It used to
  reach Playwright as if it were a locator and fail as "locator.count is not
  a function". `dsl.md` says that a point is `[x, y]`.

## 0.1.1 (2026-09-28)

The first version published by the release workflow rather than by hand.

### Changed

- Where there is no `versioncam.config.ts`, `doctor` and every other command
  say how to get one: `npx versioncam init`, then `/versioncam`, whose first
  run writes it from the repository. Or write it by hand, a default export
  from `defineRecorder()`. They used to offer only the second, which is the
  long way round for anyone using the skill.
- The skill's plugin manifest links to version.cam, and no longer to a
  repository nobody outside can open.

## 0.1.0 (2026-09-25)

The first published version, and no longer on npm: install 0.1.1 or later.
It was built in work packages before it had a version number, so this entry
is grouped by them, newest first.

### Publishing

- Licensed under the Functional Source License 1.1 with Apache 2.0 as the
  future licence (`FSL-1.1-ALv2`). Use it on your own apps and in your own
  CI, commercial work included, but not in a competing product or service.
  Each version is also available under Apache 2.0 two years after its
  release.
- `versioncam install` installs the Chromium that this version's Playwright
  expects, and `--with-deps` adds its system libraries on Linux CI. `doctor`
  names it when the browser is missing.

### Reproducible on Linux

- A draft recording reproduces on Linux. Chromium now repaints whole tiles
  (`--disable-partial-raster`). At a draft's CSS scale, repainting only what
  the page reported as changed had left one pixel of a just-typed letter
  stale in about half of all runs on a CI runner. Full recordings are
  byte-identical with and without it.
- The page's clock moves only when the recorder moves it: 1/fps a frame, and
  16 ms a tick while it waits. It used to run on real time between frames,
  where one slow screenshot had moved it 840 ms and fired an app's timer
  seven frames early. `offCamera` spends no time on the page's clock. A
  sign-in hook runs with the clock ticking. A target that is not yet on
  screen is waited for in ticks, so it arrives on the same tick every run.

### Versioncam (2026-09-24)

- One name for everything: the package and CLI `versioncam`, the config
  `versioncam.config.ts`, the output directory `.versioncam/`, the skill
  `/versioncam`.
- `webServer` in the config, with Playwright's fields. Every command that
  drives the app starts it when nothing answers, and stops everything it
  started.
- `versioncam stability` records a clip twice the same way and says whether
  the app reproduces, with the two pictures behind the first frame that
  differs. `frame --at <label>` renders the frame a beat shows. `inspect`
  says where each name came from. `measure` prints what each match says.
- One skill and one reviewer file, installed by `versioncam init`. The
  skill's first run in a repository writes the config and proves the app
  records the same way twice before it writes a clip.

### The authoring loop (2026-09-22)

- The agent skill: inspect the app, write a clip, record it, have a fresh
  reviewer judge a contact sheet, fix what it finds. No API key: the model is
  whichever agent session runs it.
- `versioncam review`, the checks that need no eyes. `sheet --at-marks`,
  sampled at the beats. Recordings that describe their beats (`marks`) and
  their waits (`settles.json`). `failure.png` and `failure.json` when a clip
  breaks. `s.drag`. `cursorStart`. Bounds on a clip's length that the app
  sets for review.

### Speed (2026-09-21)

- Capture on change: a frame is photographed only when the page can have
  changed. That skips 81% to 95% of frames on the example app and leaves the
  recording identical.
- `--draft`: fifteen frames a second at CSS scale, for looking at while
  writing a clip.
- `record` prints where the time went.

### The package (2026-09-21)

- The recorder, extracted from the prototype it grew up in: a config
  boundary (`defineRecorder`), the clip DSL, a renderer with presentation as
  an optional layer, the CLI, and an example app whose CI records its clips
  on every push.
