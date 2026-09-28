# Changelog

What a user of `versioncam` would want to know about each version, newest
first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [semantic versioning](https://semver.org/): while the
major version is 0, a minor version may change the config or the clip DSL,
and its entry here says how.

## [Unreleased]

## [0.1.1] — 2026-09-28

The first version published by the release workflow rather than by hand.

### Changed

- Where there is no `versioncam.config.ts`, `doctor` and every other command
  say how to get one: `npx versioncam init`, then `/versioncam`, whose first
  run writes it from the repository — or by hand, a default export from
  `defineRecorder()`. They used to offer only the second, which is the long
  way round for anyone using the skill.
- The skill's plugin manifest links to version.cam, and no longer to a
  repository nobody outside can open.

## [0.1.0] — 2026-09-25

The first published version. It was built in work packages before it had a
version number, so this entry is grouped by them, newest first.

### Publishing

- Licensed under the Functional Source License 1.1 with Apache 2.0 as the
  future licence (`FSL-1.1-ALv2`): use it on your own apps and in your own
  CI, commercial work included; no competing product or service; each
  version is also available under Apache 2.0 two years after its release.
- `versioncam install` installs the Chromium that this version's Playwright
  expects — `--with-deps` adds its system libraries on Linux CI — and
  `doctor` names it when the browser is missing.

### Reproducible on Linux

- A draft recording reproduces on Linux. Chromium now repaints whole tiles
  (`--disable-partial-raster`): at a draft's CSS scale, repainting only what
  the page reported as changed had left one pixel of a just-typed letter
  stale in about half of all runs on a CI runner. Full recordings are
  byte-identical with and without it.
- The page's clock moves only when the recorder moves it — 1/fps a frame,
  16 ms a tick while it waits — instead of running on real time between
  frames, where one slow screenshot had moved it 840 ms and fired an app's
  timer seven frames early. `offCamera` spends no time on the page's clock;
  a sign-in hook runs with the clock ticking; a target that is not yet on
  screen is waited for in ticks, so it arrives on the same tick every run.

### Versioncam — 2026-09-24

- One name for everything: the package and CLI `versioncam`, the config
  `versioncam.config.ts`, the output directory `.versioncam/`, the skill
  `/versioncam`.
- `webServer` in the config, Playwright's fields: every command that drives
  the app starts it when nothing answers, and stops everything it started.
- `versioncam stability` records a clip twice the same way and says whether
  the app reproduces, with the two pictures behind the first frame that
  differs. `frame --at <label>` renders the frame a beat shows; `inspect`
  says where each name came from; `measure` prints what each match says.
- One skill and one reviewer file, installed by `versioncam init`; the
  skill's first run in a repository writes the config and proves the app
  records the same way twice before it writes a clip.

### The authoring loop — 2026-09-22

- The agent skill: inspect the app, write a clip, record it, have a fresh
  reviewer judge a contact sheet, fix what it finds. No API key; the model
  is whichever agent session runs it.
- `versioncam review` — the checks that need no eyes; `sheet --at-marks`,
  sampled at the beats; recordings that describe their beats (`marks`) and
  their waits (`settles.json`); `failure.png` and `failure.json` when a clip
  breaks; `s.drag`; `cursorStart`; review bounds on a clip's length that the
  app sets.

### Speed — 2026-09-21

- Capture on change: a frame is photographed only when the page can have
  changed, which skips 81–95 % of frames on the example app and leaves the
  recording identical.
- `--draft`: fifteen frames a second at CSS scale, for looking at while
  writing a clip.
- `record` prints where the time went.

### The package — 2026-09-21

- The recorder, extracted from the prototype it grew up in: a config
  boundary (`defineRecorder`), the clip DSL, a renderer with presentation as
  an optional layer, the CLI, and an example app whose CI records its clips
  on every push.
