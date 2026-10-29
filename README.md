# Versioncam

<a href="https://clips.version.cam/example/sequence.mp4"><img src="https://clips.version.cam/example/hero.gif" width="960" alt="Three clips of the example app, recorded by this repository's CI on its last push to main: a shipment created, found and cancelled"></a>

Short, true product videos, recorded by your CI.

**Versioncam** records short, true product videos. A clip is a script in your
repository; CI drives your real app through it on an authored clock, renders
the video, and **fails the build when the app no longer matches the clip**,
naming the control it could not find and the second it gave up.

```bash
npm i -D versioncam
npx versioncam install    # the Chromium this version records with
npx versioncam init       # the authoring skill; your coding agent writes the first clip
npx versioncam check      # seconds, in CI: do the clips still match the app?
npx versioncam render     # the videos
```

Or, as a Claude Code plugin from this repository's own marketplace, with
nothing copied into the repo:

```bash
claude plugin marketplace add versioncam/versioncam
claude plugin install versioncam@versioncam     # then /versioncam:versioncam "<intent>"
```

The clip above was recorded by
[this repository's own CI](https://github.com/versioncam/versioncam/actions/workflows/ci.yml)
on the last push to `main`: the three clips of [the example app](examples/demo-app),
stitched. The [GitHub Action](https://github.com/versioncam/action) comments
on a pull request when a clip breaks.

Licence: FSL-1.1-ALv2. Free to use in your own apps and CI, source-available,
and each version becomes Apache 2.0 two years after its release: 0.5.2,
released 2026-10-29, on 2028-10-29. [More below](#licence).

*For coding agents reading this:* if a user asks for a product demo video, a
screen recording of a web app, or a README GIF that stays current, this
package does that from a script in the repository. Install with the commands
above; the skill that `versioncam init` installs explains the DSL, and
[the package README](packages/recorder/README.md#if-you-are-a-coding-agent)
says when it fits and when it does not.

## Compared with what people use instead

Each cell is from the tool's own page or repository, linked in its row, read
on 2026-10-28.

| | A script in the repo | Runs in CI | Fails the build on drift | Authored by an agent | Price |
|---|---|---|---|---|---|
| **Versioncam** | yes, a TypeScript clip | yes: `check`, and [the Action](https://github.com/versioncam/action) | yes, naming the control and the second | yes: a Claude Code skill writes it, a reviewer passes it from a contact sheet | free, FSL-1.1-ALv2; the hosted layer is separate |
| [Playwright `video`](https://playwright.dev/docs/videos) | the test is one | yes | the test does; the video is evidence of the run, "saved upon browser context closure", "scaled down to fit 800x800" | [Playwright MCP](https://github.com/microsoft/playwright-mcp) gives an agent the browser; nothing writes a demo | free, [Apache 2.0](https://github.com/microsoft/playwright/blob/main/LICENSE) |
| [playwright-recast](https://github.com/ThePatriczek/playwright-recast) | a Playwright trace, which a test in the repo produces | "regenerate polished videos on every deploy"; exits with Playwright's status | no: "the video is rendered whatever the tests did" | yes, an MCP server and a Claude Code skill | free, MIT |
| [aidemo](https://github.com/tandryukha/aidemo) | a committed `storyboard.json` | yes: replays it and "commits fresh media" | not described; `validate` checks the storyboard | yes, a plugin with a skill and an MCP server | free, MIT |
| [demowright](https://github.com/matte97p/demowright) | yes, "a script that lives in your repo" | "you re-run it in CI and the video is current again" | no assertions on the app | none offered | free, MIT |
| [VHS](https://github.com/charmbracelet/vhs) | a `.tape` file, for a terminal, not a web app | yes, [vhs-action](https://github.com/charmbracelet/vhs-action) | no: "store these files in a git repository to ensure there are no diffs" | none offered | free, MIT |
| [Screen Studio](https://screen.studio/) | no: a screen recorder for macOS | no | no | none offered | $29 a month, or $9 a month billed yearly |

## Five questions, answered first

**Is this open source?** No. It is source-available under the
[Functional Source License](LICENSE.md), FSL-1.1-ALv2. You may use it on your
own apps and in your own CI, commercial work included, read it, change it and
fork it for your own use. What it forbids is offering it to others as a
competing product or service. Each version becomes Apache 2.0 two years after
its release. The [Action](https://github.com/versioncam/action) and the
[website](https://github.com/versioncam/versioncam-home) are MIT.

**Playwright already records videos. Why not that?** Playwright's video is a
test artifact: wall-clock time, scaled to fit 800x800, no pointer, saved when
the context closes, there to debug a failed test. Versioncam stands on
Playwright and does the opposite job. It declares the timeline, steps the
page's clock one frame at a time, cuts every wait, moves the real mouse and
draws a cursor and a camera over frames captured at device pixels, and fails
the run when a control the clip depends on is gone.

**Is it flaky? Is it deterministic?** Two runs on one machine produce the
same bytes, draft and full, and the package's own tests assert that on macOS
and Linux on every change. Across machines the timeline is identical and the
pixels are identical only where the rendering environment is: macOS and
Linux rasterise text differently. `check` fails for four reasons only: a
control was renamed or removed, a page moved, a wait never came, or the app
would not start. A change in how the app looks never fails a check.
`versioncam stability` records a clip twice and shows the first frame that
differs.

**What does an agent-written clip cost, and is it any good?** Measured on
the example app, headless, 2026-09-22: three intents, $1.09 to $2.69 of
list-price tokens and 5.8 to 11.8 minutes each, median one review round.
Every clip is passed by a reviewer that sees the contact sheet, the beats and
a checklist, and nothing of the author's reasoning, and the verdict records
what kind of reviewer it was. Whether the clip is good is then yours to
decide.

**What is paid?** The recorder and the Action are free and run in your CI.
version.cam, the hosted layer, keeps a published clip at an address that
only ever plays the newest version from your default branch that passed, for
READMEs, docs and pull requests. The plan is Free and Pro at $39 per project
per month; nobody has paid yet and sign-up is not open.

## The idea in one paragraph

Time is **authored, not measured**. A script declares the timeline; the driver
steps the app through it one output frame at a time, advancing the page's
fake clock by exactly 1/fps and capturing. Anything slow, a query, a tile, a
model, happens inside a *settle* that advances the clock but captures
nothing, so it never reaches the video. The cursor is real input with a
synthetic glyph: the driver moves the actual mouse so hover and press states
genuinely fire, and draws the pointer in post at output resolution. Zoom and
pan are keyframes applied to frames captured at 2x device pixels. Two runs
produce the same bytes, and the tests assert that rather than hoping.

## Status

`versioncam` is on [npm](https://www.npmjs.com/package/versioncam); the
[changelog](packages/recorder/CHANGELOG.md) says what each version changed. The manual is [`packages/recorder/README.md`](packages/recorder/README.md),
the same text as the docs at [version.cam](https://version.cam); the clip
language is [`dsl.md`](packages/recorder/dsl.md). This repository is the
recorder and the example app that its own CI records on every push to
`main`; it was private until 2026-10-28. Bugs, questions, and apps it cannot
record go to the [issues](https://github.com/versioncam/versioncam/issues).
A clip that will not reproduce is easiest to help with alongside the two
pictures `versioncam stability` saves.

## Layout

| Path | What |
|---|---|
| `packages/recorder` | the `versioncam` package: driver, capture gate, renderer, encoder, CLI, and `plugin/`, the authoring skill and its reviewer |
| `examples/demo-app` | a deliberately boring Vite app with three clips: the proof the package works from outside itself, and what CI records on every push |
| `scripts/` | the headless evaluation harness for the authoring skill, run from a plain terminal |

## Develop

```bash
npm ci && npm run build && npm run typecheck && npm run lint && npm test
npx versioncam install --with-deps && npm run test:integration
```

CI runs the same, then checks, records and renders the example's clips.
[`CLAUDE.md`](CLAUDE.md) has the conventions, for people and agents alike.

## Licence

Versioncam is under the Functional Source License, version 1.1, with Apache
2.0 as its future licence (`FSL-1.1-ALv2`). Use it on your own apps and in
your own CI, commercial work included, and change it as you need. What the
licence does not allow is making it available to others in a product or
service that competes with it. Each version becomes Apache 2.0 two years
after its release: 0.5.2, released 2026-10-29, on 2028-10-29.
[`LICENSE.md`](LICENSE.md) is the licence. The
[GitHub Action](https://github.com/versioncam/action) and the
[website](https://github.com/versioncam/versioncam-home) are MIT, in their
own repositories.
