# Changelog

What a user of `versioncam` would want to know about each version, newest
first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [semantic versioning](https://semver.org/). While the
major version is 0, a minor version may change the config or the clip DSL,
and its entry here says how.

## Unreleased

### Added

- `versioncam cloud embed` prints a fifth snippet when version.cam gives it:
  the iframe as JSX, for MDX on Docusaurus, Nextra or Fumadocs. Docusaurus
  fails its build on the HTML iframe, because React won't take a `style`
  written as a string.
- `versioncam cloud embed` prints a GitBook snippet when version.cam gives it:
  the block of our GitBook integration, as a repository synced with Git Sync
  writes it, after the line that says where to install the integration.
- The README has a new section, *Embed a clip*. It says which snippet plays on
  which docs platform, and the date we tested each one.

### Changed

- The README's *Phone and desktop in one link* says how version.cam now picks
  the phone clip: the element measures the window, not the column it sits in,
  and the plain iframe always shows the desktop clip. Before, a docs site's
  column, which is under 768 pixels wide on a desktop too, showed the phone
  clip.

## 0.7.8 (2026-11-09)

This patch changes only documentation: the setup prompt in the READMEs. Nothing
changes in the config, the clip DSL or any code.

### Changed

- The setup prompt has nothing to fill in before you send it. Paste it as it is.
  The agent installs versioncam in the app's directory and says whether each
  command worked. Then it asks what the first clip should show, and suggests ideas
  from what it finds in the app.
- On your answer the agent runs the authoring skill: as a skill where the session
  has it, and from the file `init` wrote where it does not.
- The prompt no longer repeats the offer to put the clip on version.cam. The skill
  has made that offer itself since 0.7.5, for a repository on GitHub.

## 0.7.7 (2026-11-09)

This patch changes only documentation. The READMEs now lead with the coding
agent, because the agent is how a clip gets written. Nothing changes in the
config, the clip DSL or any code.

### Changed

- *Install* starts with a setup prompt to paste into a coding agent. The agent
  installs the package, follows the authoring skill to a first clip, and asks
  before it puts the clip on version.cam. The three commands follow, for doing it
  by hand. The README says that we test the skill with Claude Code and have not
  run another agent end to end.
- The README's opening says that your coding agent writes the clip from one
  sentence of yours, and that recording needs no agent and no model: CI runs the
  script as it is.
- *Configure*, *Write a clip*, *Commands*, *Connect a repository* and *When a clip
  breaks* each say what the authoring skill does there. It writes the config on
  its first run, writes the clips, runs most of the commands, offers the steps
  that connect a repository, and repairs a broken clip with `/versioncam fix`.

## 0.7.6 (2026-11-08)

This patch changes only documentation. The READMEs and the authoring skill now
state version.cam's plans as the service counts them. Nothing changes in the
config, the clip DSL or any code.

### Changed

- The README's *Plans* section gives every limit of each plan. Free is for public
  repositories only, with three projects, ten clips and five branches a project,
  thirty days of history and clips up to sixty seconds; the account's projects
  share 1 GB, thirty minutes of rendering and sixty renders on request a month; Free
  has no alerts. Pro costs $35 per private project a month or $350 a year, and adds
  private repositories, unlimited history, a hundred clips a project, clips up to
  five minutes, 20 GB, ten hours of rendering and 600 renders on request a month for
  each project, and alerts by email, Slack or GitHub issue. Max costs $145 a month or
  $1,450 a year for up to ten private projects. An account made during the beta
  pays 20% less for twelve months with the code FOUNDING.
- A private repository needs Pro or Max, not only Pro, and the root README prices
  Pro per private project and names Max.
- The skill no longer says version.cam alerts the team on every plan. It says that
  alerts need Pro or Max, that Free keeps thirty days whatever `retention` says, and
  that acknowledging a broken clip stops reminders only on Pro and Max. Before it
  tells someone that Pro is on, it offers `npx versioncam ci` when the repository
  has no workflow that publishes the clips.

## 0.7.5 (2026-11-08)

This patch adds the steps from a first clip to a permanent link. On 2026-11-07 the
authoring skill wrote, recorded, reviewed and rendered a first clip end to end on a
Windows 11 desktop, and the run ended with a video on disk and no next step. Now
every stage says what comes next. Nothing changes in the config or the clip DSL, and
no recording, rendering or publishing code changed: the example app's clips record
the same frames as on 0.7.4.

### Added

- `npx versioncam ci` writes `.github/workflows/versioncam.yml` at the repository's
  root: the versioncam Action checks the clips on every pull request, and on every
  push to the default branch it checks them and publishes them to version.cam. A
  config below the root gets `working-directory`, and `npm ci` runs where the
  lockfile is. `--print` prints the file instead, and `--force` replaces one that is
  there. Afterwards it says what to do next, which depends on whether GitHub's public
  API says the repository is public or private. It asks without a token.

### Changed

- When version.cam doesn't have a repository yet, `cloud status` says that the
  project appears after the workflow first runs on the default branch, and that
  `npx versioncam ci` writes the workflow if there is none. It also says when the Versioncam GitHub App is not
  installed on the repository, once version.cam reports that.
- `cloud plan` says the plan in a sentence, then what it includes. Pro and Max say
  that a private repository needs the GitHub App, and how to turn on alerts.
- While version.cam's beta is private, `cloud login` and `cloud plan` say how to ask
  for Pro for free, and `cloud plan` on Free prints the email to send. The CLI learns
  this from version.cam, so it stops saying it when the beta ends.
- The authoring skill goes on after the first clip: it offers the workflow, runs
  `npx versioncam ci` with your yes, offers `cloud login`, and for a private
  repository repeats the steps to get Pro. It never sends an email for you, and never approves a sign-in code. A bare `/versioncam` asks what the clip should show instead of starting.
- `doctor`'s two notes begin with "optional:" and say which commands need the full
  Chromium and ffprobe.
- `render` on a terminal says which clip it is rendering, with its frames and frame
  rate. Nothing changes without a terminal.
- We rewrote every message the CLI prints, the READMEs, the skill and `dsl.md` in
  plain language. Commands, numbers, exit codes and machine-readable output are
  unchanged. `docs/voice.md` in the repository is the rule.
- The README says what the Windows desktop run proved. The package's own test suite
  still does not pass on Windows, and we have not tested stopping a recording with
  Ctrl+C there.

## 0.7.4 (2026-11-06)

A patch: versioncam runs on Windows. Every command stopped there before it started, and
this is the first version a Windows machine can use. CI records and renders the example
app on a Windows runner, and an Angular app and a Next.js app passed there too. The
package's full test suite does not pass there yet, because of what its tests assume about
paths and line endings, and it has not been tried on a Windows desktop. Nothing changes
in the config or the clip DSL, and the example app's clips record the same frames as on
0.7.3. On macOS and Linux the one change anyone will see is in `doctor`.

### Fixed

- The command line starts on Windows. Every `npx versioncam` stopped in the launcher
  with `ERR_UNSUPPORTED_ESM_URL_SCHEME`, before any command ran, because it imported a
  `D:\\` path as though it were a URL.
- The app's server stops on Windows. `process.kill(-pid)` signals a process group, which
  Windows does not have, so every command left the dev server running and the next one
  refused the port. There it is now stopped with `taskkill`, the whole tree at once. An
  error message no longer carries a carriage return from what the server printed.
- `doctor` no longer fails on a missing ffprobe. Only `render --sequence` reads it, and
  the skill stops when `doctor` fails, so it stopped on a machine that could do
  everything the skill asks for. What is absent but not wrong now has a hyphen beside it,
  not a tick. The hints for ffmpeg name `winget install ffmpeg`.
- `inspect /` and `measure /` work in Git Bash, where Claude Code runs commands on
  Windows. Git Bash rewrites an argument that begins with a slash into a Windows path
  before node sees it, and the page asked for was then no page at all.
- `cloud login` no longer says the token is readable only by you on Windows, where
  file modes do not apply. There the file is as private as its folder.

## 0.7.3 (2026-11-05)

A patch, from a rehearsal on the official templates of Next.js, SvelteKit, Nuxt,
Angular, Docusaurus and Django. Nothing changes in the config or the clip DSL, and
the example app's clips record the same frames as on 0.7.2. A clip that recorded
before records the same frames, unless it filmed a dev server's toolbar, or scrolls
beneath a cursor that rests on something with a hover state, where a hover now lands
on the frame it should.

### Added

- The dev tools of Next, Nuxt and Astro are hidden from every clip, with no setting.
  Each was in the video, under the caption, and on a clock of its own, which failed
  `stability` at frame 0 on the first clip of a new app. Any other toolbar stays, and
  the README says how to turn it off.
- What the page throws is said: printed by `record` and `check` for a clip that goes
  on, and beside the failure of one that does not. Next's error dialog goes with its
  badge, so this is how an error shows now. A failed clip on such a page leaves
  `failure-tools.png` beside `failure.png`, with the tools showing, and a Next build
  error is there.
- `inspect` and `measure` take `--viewport <w>x<h>`, to look at the page at a
  phone's size. An app's phone layout has controls its desktop layout does not.

### Changed

- An id that is exactly a clip's picks that clip alone. `record 01-checkout` used
  to take `01-checkout-mobile` too, and nothing could name the desktop clip.
  `record checkout` still takes both.
- A flag a command does not read is refused. `stability --fulll` used to run a
  draft and print `stable`.
- A 5xx from `webServer.url` means not ready yet. The command keeps asking until
  `timeoutMs`, then stops and says what it got.
- `render` says which clip it is rendering, at a terminal, and how long each took.
- `stability` says to check with `--full` after a draft that differs, since a draft
  can differ by edge pixels nobody can see.
- `review` and `frame` print ranges with "to". No command prints an en dash now.

### Fixed

- A clip can load another document. A plain link, a form post, a redirect or a
  second `s.open` used to fail the clip, with `Execution context was destroyed`
  or `The document reloaded`, so a server-rendered app could not be filmed past
  its first page. The next frame is now of the finished page, as after a settle.
  A page that has not arrived after 90 s fails the clip and names the address. A
  reload nobody asked for still fails the clip, and says so; one before frame 0 has
  lost nothing and does not.
- Nuxt's dev server, which answers 503 while it compiles, no longer fails the
  first clip of every cold start.
- A hover under a scroll is decided on the frame the scroll reaches it, not on
  Chromium's own timer. Every full recording of a clip that scrolled on Docusaurus
  differed from the last by a heading's hover fade.
- A `login` hook and `offCamera` can use a path: `page.goto("/sign-in")`.
- `inspect` lists a submit `<input>` as a button with the name it shows, rather
  than as a nameless field.

## 0.7.2 (2026-11-04)

A patch: a project whose own `viewport` is portrait renders at the size the
README says. Nothing changes for a project with a landscape or square
viewport, and a publish sends what 0.7.1 sent. version.cam reads such a
publish from 0.7.2 by the same rule once it is updated the same week; until
then its video of such a project is 410 by 888, as 0.7.1 rendered it.

### Fixed

- `output.width` is the video's longer side in a project whose config
  `viewport` is portrait too. A 390 by 844 project at the default output
  rendered 410 by 888 rather than 888 by 1920, and a 1600 by 900 clip in it
  888 by 500 rather than 1920 by 1080, since the rule was applied to its
  already portrait size a second time. A clip with its own `viewport` in a
  landscape project was right and is unchanged. `versioncam frame`, `sheet`
  and `preview` take the same size.

## 0.7.1 (2026-11-03)

A patch: a clip with its own viewport renders at its own shape, as the
README always said, and a phone clip's video is 1920 high rather than
4155. Nothing changes for a landscape clip, and a publish sends what 0.7.0
sent, so version.cam needs nothing new to take it; it shows a phone clip
in place of its desktop clip once it is updated the same week.

### Fixed

- A clip with its own `viewport` renders at its own shape. It rendered at
  the config's: a phone clip at 390 by 844 came out as the top of its page
  blown up to 1920 by 1200, and a 1600 by 900 clip in a 1440 by 900 config
  lost its sides. `versioncam frame`, `sheet` and `preview` take the
  recording's shape too.

### Changed

- `output.width` is the video's longer side: a portrait clip's video is
  that high, so a phone clip is 888 by 1920 rather than 1920 by 4155. This
  changes nothing for a landscape or square clip, and nothing that
  `versioncam publish` sends.

### Added

- `render --sequence` refuses clips of two sizes with a message naming two
  of them, before ffmpeg runs.
- The README says a clip has no sound, and how a phone clip is named: a
  clip called `<id>-mobile` is shown in place of `<id>` on a narrow screen,
  on its page, in its embed and through the web component, once
  version.cam is updated the same week.

## 0.7.0 (2026-11-02)

A minor version: the config gains `replay`, the clip DSL gains
`s.fileWindow`, a second form of `s.drag` and `modifiers` on `s.click`,
and `record` and `stability` take `--replay`. A config without `replay`
records as it did with 0.6.0, and the render config is unchanged, so a
publish needs nothing new of version.cam.

### Added

- `replay` in the config records a clip's responses the first time it runs
  and serves them on every run after, so a map's tiles, a model's answer or
  a job's status are the same in every recording. `record` names the
  requests by URL; each clip's replay is a HAR in `replay/` beside the
  config, with binary bodies under `replay/bodies/` by hash, and is meant to
  be committed. A request the replay covers and does not hold fails the clip
  and names it. `pace` delivers a streamed response, an event stream over
  `fetch` or `EventSource`, or lines of JSON, a piece at a time on the
  page's clock. Authorization, cookie and API key headers are never written,
  and `redact` leaves query parameters out.
- `s.fileWindow(files, options?)` draws a file window over the page, as
  Finder draws one, to select files in and drag onto the app's dropzone,
  which receives them as `File` objects through the events a real drag
  sends: the upload a clip can film. A click selects a row, with Shift it
  extends, with Meta it adds or removes.
- `s.drag(from, to, options?)`, from one locator or point to another, beside
  the form in fractions of one box; and `modifiers` on `s.click`, for a
  shift-click. Both strokes take Meta and Control as well as Shift and Alt.
- `versioncam record` and `stability` take `--replay auto|record|replay|live`.
  `doctor` lists each clip's replay, and `check` points out one older than
  ninety days.

## 0.6.0 (2026-11-02)

A minor version: the clip DSL gains `s.scroll`, the config gains
`theme.cursor` and `motion.scrollDurationMs`, and a page's own smooth
scrolling is instant while it is recorded. A config that sets none of
the new fields renders and publishes as it did with 0.5.3, and records
the same unless its app scrolls smoothly from a script.

### Added

- `s.scroll(target, where, options?)` scrolls a pane, or the page, on the
  clip's clock: `{ by: px }`, `{ to: "top" | "bottom" | px }`, or
  `{ into: locator, block? }`, one eased step a frame, so the frames inside
  a scroll are the same on every run. The end is clamped to what the element
  can scroll, and an element that cannot scroll at all is refused by name.
  `motion.scrollDurationMs` (700) is its default length. A recording keeps
  its scrolls in the timeline's new `scrolls`, which a recording without one
  does not have.
- `theme.cursor: { style, ripple }` in the config. `style: "dark"` draws
  the system's black arrow with a white hairline, as a screen recording of
  a Mac shows it, and `ripple: false` draws no ring on a click. The default,
  `{ style: "light", ripple: true }`, is the white arrow and the ring every
  earlier version drew, to the byte.

### Changed

- A page's script can no longer scroll smoothly while it is recorded:
  `scrollIntoView`, `scrollTo`, `scrollBy` and `scroll` given
  `{ behavior: "smooth" }` scroll at once, as a stylesheet's
  `scroll-behavior: smooth` already did. The browser animated those scrolls
  on its own clock, so the frames during one differed between runs. A clip
  whose app scrolled itself that way now shows the scroll land in a frame;
  `s.scroll` is how a clip shows one move.
- `versioncam publish` sends `theme.cursor` and `motion.scrollDurationMs`
  only when the config changes them, so a config that changes neither
  publishes exactly what 0.5.3 did. One that changes either needs
  version.cam from cloud-v1.8.0, which knows both; before it, the publish
  is refused with a message that names the key.

## 0.5.3 (2026-11-01)

A patch version: the config and the clip DSL are as they were. The browser
installs on the Ubuntu that GitHub's `ubuntu-latest` became, and the README
says what the plans are and how the private beta gives Pro.

### Fixed

- `versioncam install` on an Ubuntu newer than its Playwright knows, which
  is GitHub's `ubuntu-latest` since it became 26.04 in October 2026: where
  Playwright refuses the OS outright, the installer runs again as
  `ubuntu24.04`, the newest Ubuntu it knows, whose build and system
  libraries record the same. `login` and `preview` fetch their browser the
  same way. An override set by hand in `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`
  is left alone.

### Changed

- The README's version.cam section states the plans, as planned: Free for
  public repositories, Pro for private ones at $35 a project a month, Max
  for ten projects at $145, and how the private beta gives Pro away.

## 0.5.2 (2026-10-29)

A patch version: the config and the clip DSL are as they were. The README
now speaks to coding agents, the skill installs from the repository's own
marketplace, and the browser install is a third of what it was.

### Changed

- The README has a section for coding agents: when versioncam fits, the exact
  commands, and what to tell the person about the licence. Bugs and
  questions go to github.com/versioncam/versioncam, where the source is
  public since 2026-10-28.
- The skill installs as a Claude Code plugin from that repository's own
  marketplace, `/plugin install versioncam --marketplace versioncam/versioncam`,
  beside `versioncam init` and `--plugin-dir`; the plugin's manifest carries
  the package's version.
- `versioncam install` fetches the headless shell alone, the Chromium that
  records: 190 MB on a Mac, where both builds were 528. `login` and `preview`,
  the two commands that open a window, fetch the full browser the first time
  they run and say so first; `versioncam install --full` fetches both at once.
  `doctor` reports the shell as `chromium`, and under `window` whether the
  full browser is there, which is never a failure.

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
