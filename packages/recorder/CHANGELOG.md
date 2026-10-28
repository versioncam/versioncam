# Changelog

What a user of `versioncam` would want to know about each version, newest
first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [semantic versioning](https://semver.org/). While the
major version is 0, a minor version may change the config or the clip DSL,
and its entry here says how.

## Unreleased

### Changed

- The README has a section for coding agents: when versioncam fits, the exact
  commands, and what to tell the person about the licence. Bugs and
  questions go to github.com/versioncam/versioncam, where the source is
  public since 2026-10-28.
- The skill installs as a Claude Code plugin from that repository's own
  marketplace, `/plugin install versioncam --marketplace versioncam/versioncam`,
  beside `versioncam init` and `--plugin-dir`; the plugin's manifest carries
  the package's version.

## 0.5.1 (2026-10-11)

A patch version: two clips that came out wrong now record and render as
they should. The config and the clip DSL are as they were.

### Fixed

- A settle whose page did not change, a menu already open or a form already
  filled, no longer dims the whole picture almost to black for a tenth of a
  second after it. The renderer dissolved from the page into itself, drawing
  it see-through over the background. Where two settles come within the
  dissolve of each other, the dissolve now follows the later one, rather than
  fading the new page in, a little back out, and in again.
- A CSS animation that has run its course now finishes, so its `finished`
  promise resolves, as in a browser nobody is filming. Components that
  unmount once their exit animation has finished, Base UI's Dialog, Popover,
  Menu and Tooltip among them, stayed mounted after they closed: a closed
  dialog's invisible backdrop stayed over the page and took the next click,
  so a link seemed to do nothing and the step after it failed with
  `Nothing matched`. A clip that finished the animations itself to get past
  this no longer needs to.

## 0.5.0 (2026-10-07)

A minor version: commands for version.cam, and the skill learns to use them.
Nothing records or renders differently, and the config and the clip DSL are
as they were.

### Added

- **`versioncam cloud`** does from a terminal, or from an agent's shell, what
  the dashboard at app.version.cam does. `cloud login` signs the command
  line in with a code you approve in a browser, on any device, so it works
  over SSH and in a sandbox. The token lasts seven days and is kept in
  `~/.config/versioncam/credentials.json`, or under `$XDG_CONFIG_HOME`: a
  file only you may read, with each API's sign-in apart, so staging and
  production sit side by side. No command prints it, and `cloud logout`
  revokes it. `VERSIONCAM_API` chooses the API from the shell alone: unlike
  `publish`, the `cloud` commands never take it, or `XDG_CONFIG_HOME`, from
  a `.env` file, and say so when one sets it, so a cloned repository cannot
  send a sign-in to a server of its choosing.
- Reading needs nothing more. `cloud status` says of each clip whether it is
  current or broken, since when, who acknowledged it, and what your pages
  play meanwhile, then the plan and where to manage the project; outside a
  clone it lists every project you can see. `cloud failure <clip>` says
  which step stopped a broken clip and why, and saves the page as it was to
  `.versioncam/failures/<clip>.png`. `cloud ack <clip>` is the dashboard's
  "I know, keep the old one". `cloud embed <clip>` prints the snippets that
  embed a clip, and its files, and `cloud plan` the plan and the pages to
  upgrade and pay on. Each read takes `--json`, and `--project owner/repo`
  names a project when the repository's `origin` on GitHub is not the one.
- **`cloud set`** changes a project's visibility, retention, "Tell viewers
  when a clip is broken" or alerts, and only once you approve that one change
  in the browser: it prints the change in a sentence, an address and a code,
  and waits up to ten minutes. Paying, deleting a project and tokens for CI
  outside GitHub stay on app.version.cam.
- **The skill's `platform.md`**, which `versioncam init` installs beside the
  other briefs: `/versioncam status`, `/versioncam fix [clip]` (why a clip
  broke, a repair, and a pull request for it) and `/versioncam embed <clip>`,
  and any question about the project on version.cam. It changes nothing you
  did not ask for, leaves every approval to you, and never touches the
  token. A skill already installed gets it from `versioncam init --force`,
  which also overwrites any brief you edited.
- The README's **`## version.cam`** section: connecting a repository, what
  happens when a clip breaks on each plan, who can see the clips, the
  `cloud` commands, and a repository whose CI runs elsewhere.

### Changed

- `publish --report` writes version.cam's whole answer, not only its
  `project` and `versions`, so a field the service adds reaches the
  Action's job summary without a release of this package to carry it:
  where to manage the project, who can see its clips, whether its plan tells
  anyone when a clip breaks, and what a broken clip's pages play.
- `publish` calls a clip whose check failed on the default branch "broken",
  not "stale", and says that a project token, `VERSIONCAM_TOKEN`, is for a
  repository outside GitHub.

## 0.4.1 (2026-10-06)

A patch version: nothing records or renders differently.

### Changed

- The issue tracker lives in the versioncam organisation now, at
  [github.com/versioncam/versioncam-home](https://github.com/versioncam/versioncam-home/issues).
  The package's `bugs` link and the README's *Help* say so; the old address
  redirects.

## 0.4.0 (2026-10-05)

A minor version: clips whose app uses CSS transitions record differently.

### Changed

- **CSS transitions play.** Until now the recorder set every transition to
  zero, so a change landed in the frame after it, and the only motion was
  the renderer's crossfade at a settle. A change made inside a hold, such as
  a map zooming on a wheel notch, jumped. Now each transition runs at its
  authored duration and easing, on the page's own clock, from the frame the
  recorder first sees it, the same on every run: menus, dialogs and
  popovers open the way the app wrote them, and a map zooms over its
  frames. `transitionend` fires on the frame the transition's time runs out,
  so code that waits for it runs there.
- **A settle waits for running transitions** to finish, as it waits for
  requests, so the frame after a settle shows them finished. A settle held up
  by them names them in `settles.json`: `transitions(1)`.
- To record as before, set `capture: { transitions: "zero" }` in the config,
  or in one clip's options. Transitions in an iframe stay zeroed either way,
  since nothing drives an iframe's clock.

### Security

- The page that renders a recording or a scene now reaches nothing but its
  own routes. Every request it makes for another origin is refused before
  it leaves the browser, and every WebSocket is closed before it connects;
  until now, a WebSocket from the page could reach a port on the machine
  doing the rendering. A scene that loaded something from elsewhere, such
  as a web font, renders without it: put what a scene draws in its module.

## 0.3.0 (2026-09-29)

A minor version: a new command, a new config field, and new files beside a
recording. Clips record exactly what they did before. `versioncam publish`
is for version.cam's hosted service, which opens with its beta; everything
else in this version works without it.

### Added

- `versioncam publish` sends the recordings and what their last run said to
  version.cam, which renders them and keeps them at a living address. It
  records and renders nothing itself: for each clip the config defines, it
  sends the recording if the clip's last run passed, or the failure if it
  did not. Only the screens the service has not seen are uploaded. The
  credential comes from the environment (`VERSIONCAM_OIDC_TOKEN`, which the
  versioncam GitHub Action requests, or a project token in
  `VERSIONCAM_TOKEN`), never from a flag. `--dry-run` prints what would be
  sent.
- `--report <file>` on `check`, `render` and `publish` writes what happened
  as JSON, for a CI step to read instead of parsing what the command
  printed: each clip's result and the step a failure stopped at, the files a
  render made, the living URLs a publish made.
- A recording keeps `targets.json` beside its timeline: where each step's
  target was when the step began, by the step's index in `steps`. It is
  what lets a screenshot be cropped to the control a step used.
- `failure.json` names the step that was running: its index in `steps` and
  its call, such as `click`.
- `output.threads` in the config, and `VERSIONCAM_FFMPEG_THREADS` for one
  run, fix how many threads each encoder uses, so a render made on another
  machine is the same file.
- `versioncam/publish`, an entry point with the publish protocol's types and
  `validateTimeline`, which pulls in nothing that needs Node.
- `versioncam --version` prints which versioncam this is, for a script that
  must know before it drives it. The reports of `render` and `publish` carry
  the version too, and `publish --report` is written when a publish fails,
  with the error, so a CI step can say why without the log.

### Changed

- A clip that fails before its first step (a saved session the browser
  refuses, say) now leaves `failure.json` too, with its message and no step,
  frame or picture, so `check --report` and `publish` say why it failed.

### Fixed

- A render is now the same bytes every time it is made from one recording.
  The WebM muxer wrote a random id into every file, so two renders of the
  same recording always differed, and both muxers stamped each file with
  the ffmpeg build that wrote it.

## 0.2.0 (2026-09-29)

A minor version: new config fields and new camera methods. A clip whose
camera moves never overlap records what it did before, to the byte.

### Added

- `s.camera.follow()` follows the cursor at one scale until the next camera
  line, for a clip that moves around the page: one line instead of a zoom
  before each thing the cursor uses, which zoomed in and out and panned in
  fits and starts. The camera keeps the cursor inside a dead zone in the
  middle of the frame, never shows beyond the page's edge, and moves
  smoothly without overshooting. Its path is worked out from the whole
  cursor track once the clip has run, so it keeps up with a cursor that
  crosses the page. The options are `scale` (1.35, exact rather than a
  ceiling), `deadZone` (0.3 of the frame), `smoothing` (600 milliseconds)
  and `duration` (how long it takes to ease in). Their defaults are new
  fields of the config's `motion`: `followZoom`, `followDeadZone` and
  `followSmoothingMs`. `s.camera.release()` stops following, and the camera
  comes to rest on the framing it was heading for.
- `versioncam review` warns, under `onscreen`, about a click that lands
  outside what the camera shows: the button changes, and no frame shows it
  pressed.
- `--cwd <dir>` runs any command as if from `<dir>`: that directory's
  config, `.env.recording` and `.env`, and any relative path the command is
  given or prints. It can go anywhere on the line. It is for a monorepo, run
  from the repository root or from inside the app. `npx` looks for
  versioncam only where it runs and above, so `--cwd` refuses a directory
  whose own versioncam is not the one running, and says to `cd` into it
  instead.
- `versioncam doctor` reads the scenes module a config names, and lists its
  scene ids, or says what `render` would refuse it for and how to fix it.
- `theme.presentation.captionInset` moves a caption that sits over the app:
  `{ left: n }` or `{ right: n }`, pixels of the video in from that side,
  and `right` puts it in the bottom-right corner. The default, `{ left: 40 }`,
  is where it always sat, to the byte. It is for an app whose own controls
  are where the caption was, such as an account menu at the foot of a
  sidebar or a map's legend. The README's Configure section has a table of
  every `presentation` field now, which a test holds to the type.

### Changed

- A camera line written while the camera is still moving starts at once,
  from where the camera is, and takes its whole `duration`. It used to wait
  for the move before it to arrive and then run in whatever time was left,
  so a series of pans stopped and snapped. Two camera lines written at the
  same instant used to glide to the first and cut to the second; now the
  second is the only one. A clip whose camera moves never overlap records
  exactly the camera it did before, to the byte.
- A recording whose camera follows the cursor, or eases from one move into
  another, keeps its camera as a key a frame, with a new ease, `"linear"`.
  A renderer from an earlier version draws such a recording the same way.
- `versioncam review` names a camera still moving at the end of a clip once,
  at its last key, rather than once for every key past the end.
- `versioncam init` below a repository root says where Claude Code finds the
  skill: in a session started in that directory or below it, and from the
  root only after the session has read or edited a file there.
- `render` checks everything it was asked for before it renders anything.
  An id that matches no recording and no scene, or a `--scene` the scenes
  module does not define, stops it with what there is to render. An id that
  matched nothing used to be passed over without a word.
- `versioncam --help` and the README say plainly that `render` with no ids
  renders every recording on disk, stale ones from drafts, trial runs and
  renamed clips included.

### Fixed

- The authoring skill works in a monorepo wherever the session started. It
  looks for `versioncam.config.ts` across the whole repository before
  deciding anything, works in the directory that holds it, and asks which
  when there are several. It used to look only in the directory the session
  was in. Invoked at a repository root with the app below it, it said
  versioncam was not installed, and past that it would have set the root up
  as a second app, with a second config.
- A scenes module whose scenes are not its default export is refused, with
  the file's name and the shape it should have: a `Record<string, Scene>`
  keyed by scene id. A module whose record was a named export used to count
  as having no scenes, so `render` rendered none, said nothing, and stitched
  a sequence without them. An array, a single scene, or an entry with no
  `draw`, no whole `durationFrames` or no `fps` is refused the same way.
  `render` and `preview --scene` refuse it before a browser starts, and the
  render page refuses it too, for anything that renders a scene without the
  CLI.
- `render --scene <id>` renders that scene whatever ids come with it. The
  ids used to filter the named scenes as well, so
  `render 02 04 --scene 01-intro --sequence` rendered no scene and stitched
  the recordings without it. Ids still choose among the scenes `--scene`
  does not name.
- `render --sequence` says what the sequence was stitched without: the ids
  in the config's `sequence` that this run did not render, and the ones it
  rendered that the `sequence` leaves out. The first note was in the code
  and could never print. With fewer than two of the `sequence`'s clips
  rendered, it says a sequence needs two, as it does with fewer than two
  clips at all, rather than failing.
- `render --sequence` joins clips of different frame rates, such as a
  15 fps draft beside 60 fps recordings, or a scene or a clip with an `fps`
  of its own. Every clip is brought to the highest rate among them, so none
  loses a frame. It used to print ffmpeg's error that the clips' timebases
  or frame rates do not match, and stop without a sequence. Clips that
  share one rate are stitched exactly as before.
- A sequence that fails in ffmpeg leaves the `sequence.mp4` of an earlier
  run as it was, and says that the one there is an earlier run's. It used
  to leave that file empty, or an empty one where there had been none:
  ffmpeg wrote straight to it, and had emptied it by the time it failed.
  The sequence is now written beside it and takes its place only once it
  is complete.
- A clip or scene that fails partway through `render` stops it at once, and
  leaves the last good render as it was. A scene that threw at a frame used
  to leave both ffmpeg encoders waiting for frames that would never come:
  `render` printed the error and then never exited, which in CI is a job
  that hangs until it is killed. ffmpeg also wrote straight over the
  finished files, so a playable half-clip, and the failed run's poster, took
  the place of the last good ones. The clip, its webm, its poster and its
  contact sheet are now each written beside the last and take its place only
  once complete, as the sequence is.
- A contact sheet's evenly spread tiles no longer land in the dissolve the
  renderer draws after a settle, where a tile showed the page before the
  wait ghosting through the page after it. The sheet `render` writes and
  `versioncam sheet` without `--at-marks` move such a tile to the first
  frame after the dissolve, as `--at-marks` already did for its own tiles.
  The example app's first clip had one. A scene's sheet is unchanged, since
  a scene never dissolves. `evenFrames` is exported beside `uniformFrames`
  and `markedFrames`.

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
