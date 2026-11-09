# Versioncam

<a href="https://clips.version.cam/example/sequence.mp4"><img src="https://clips.version.cam/example/hero.gif" width="960" alt="Three clips of the example app, recorded by this repository's CI on its last push to main: a shipment created, found and cancelled"></a>

[![demo verified](https://img.shields.io/endpoint?url=https%3A%2F%2Fapi.version.cam%2Fv1%2Fbadge%2Fversioncam%2Fversioncam&cacheSeconds=300)](https://clips.version.cam/versioncam/versioncam)

Short product videos of your real app, recorded by your CI.

**Versioncam** records short product videos of your real app. A clip is a
script in your repository. CI drives your real app through it on a clock the
script sets, renders the video, and **fails the build when the app no longer
matches the clip**. The failure names the control it could not find and the
second it gave up.

You don't have to write the script yourself. Your coding agent writes it from
one sentence of yours, and a separate reviewer checks the frames. Recording
needs no agent and no model: CI runs the script as it is.

The quickest start is to paste this prompt into your coding agent as it is.
The agent installs versioncam, then asks you what the first clip should show:

```text
Set up versioncam in this repository. In the app's directory, the one that
holds its `package.json` or that the app is started from, run
`npm i -D versioncam`, `npx versioncam install` and `npx versioncam init`,
and tell me whether each one worked. Then ask me what the first demo clip
should show, and suggest two or three ideas from what you find in the app.
When I have answered, use the skill that `init` installed to write, record
and review that clip: run the versioncam skill if this session has it,
otherwise read `.claude/skills/versioncam/SKILL.md`, which `init` wrote, and
follow it from start to finish.
```

We test this with Claude Code. The skill is plain Markdown, so another agent
that can run commands in your repository can follow it, but we have not run
one end to end yet.

Or by hand:

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

We test it on macOS and Linux on every change. On Windows, on 2026-11-07, a
person ran the authoring skill on a Windows 11 desktop, and it wrote and
recorded a first clip end to end. The package's own test suite does not pass
there yet, and we have not tested stopping a recording with Ctrl+C there.
[The package README](packages/recorder/README.md#install) has the details.

[This repository's own CI](https://github.com/versioncam/versioncam/actions/workflows/ci.yml)
recorded the clip above on the last push to `main`. It is the three clips of
[the example app](examples/demo-app), stitched together. The [GitHub Action](https://github.com/versioncam/action) comments
on a pull request when a clip breaks.

The licence is FSL-1.1-ALv2. The code is source-available, and you can use it
for free in your own apps and CI. Each version becomes Apache 2.0 two years
after its release, so 0.7.7, released on 2026-11-09, becomes Apache 2.0 on
2028-11-09. [More below](#licence).

*For coding agents reading this:* if a user asks for a product demo video, a
screen recording of a web app, or a README GIF that stays current, this
package does that from a script in the repository. Install it with the
commands above. The skill that `versioncam init` installs explains the DSL, and
[the package README](packages/recorder/README.md#if-you-are-a-coding-agent)
says when it fits and when it does not.

## Compared with what people use instead

Each cell comes from the tool's own page or repository, linked in its row. We
read them on 2026-10-28.

| | A script in the repo | Runs in CI | Fails the build on drift | Authored by an agent | Price |
|---|---|---|---|---|---|
| **Versioncam** | yes, a TypeScript clip | yes: `check`, and [the Action](https://github.com/versioncam/action) | yes, naming the control and the second | yes: a Claude Code skill writes it, and a reviewer approves it from a contact sheet | free, FSL-1.1-ALv2; the hosted service is separate |
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
fork it for your own use. It forbids offering it to others as a competing
product or service. Each version becomes Apache 2.0 two years after
its release. The [Action](https://github.com/versioncam/action) and the
[website](https://github.com/versioncam/versioncam-home) are MIT.

**Playwright already records videos. Why not that?** Playwright's video is a
test artifact for debugging a failed test. It runs on wall-clock time, is
scaled to fit 800x800, shows no pointer, and is saved when the context closes.
Versioncam is built on Playwright and does the opposite job. It declares the
timeline and steps the page's clock one frame at a time. It leaves every wait
out of the video. It moves the real mouse, then draws a cursor over frames
captured at device pixels and applies the clip's zoom and pan to them. It fails the run when a control the clip depends on is gone.

**Is it flaky? Is it deterministic?** Two runs on one machine produce the
same bytes. That holds for a draft (the cheap recording you make while writing
a clip, 15 frames a second at CSS scale) and for a full recording, the one
that renders. The package's own tests check it on macOS and Linux on every
change. Across machines the timeline is identical,
but the pixels are identical only where the rendering environment is the
same. For example, macOS and Linux rasterise text differently. `check` fails for four reasons only: a
control was renamed or removed, a page moved, a wait never came, or the app
would not start. A change in how the app looks never fails a check.
`versioncam stability` records a clip twice and shows the first frame that
differs.

**What does an agent-written clip cost, and is it any good?** We measured it
on the example app, headless, on 2026-09-22, with three intents. Each took
$1.09 to $2.69 of list-price tokens and 5.8 to 11.8 minutes, with a median of
one review round. A reviewer approves every clip. It sees the contact sheet,
the beats and a checklist, and nothing of the author's reasoning. Where the
host supports it, the reviewer is a registered reviewer agent. Where it does
not, the reviewer is a subagent given the same instructions. On a host with no
subagents at all, the session works through the checklist itself. The verdict
records which of the three it was. After that, you decide whether the clip is
good.

**What is paid?** The recorder and the Action are free and run in your CI.
version.cam is the hosted service. It hosts each published clip at a
permanent link that only plays the newest version from your default branch
that passed, for READMEs, docs and pull requests. Free is for public
repositories only. Pro costs $35 per private project a month, and Max costs
$145 a month for up to ten private projects. Nobody has paid yet. version.cam
is in private beta, so you can't buy a plan yet and we don't ask for a card.
Free works for public repositories once you sign in, and the first ten people
who ask get Pro for free until the beta ends. The README of the package has
[the limits of each plan](packages/recorder/README.md#plans).

## The idea in one paragraph

Time is **authored, not measured**: the script decides when each frame
happens, and the recorder does not measure how long the app really took. The
driver steps the app through the script's timeline one output frame at a time: it advances the
page's fake clock by exactly 1/fps and captures a frame. Anything slow (a
query, a map tile, a model) happens inside a *settle*, which advances the clock
but captures nothing, so it never reaches the video. The cursor is real input
with a drawn pointer. The driver moves the actual mouse, so hover and press
states really fire, and it draws the pointer afterwards at output resolution.
Zoom and pan are keyframes applied to frames captured at 2x device pixels.
Two runs produce the same bytes, and the tests check that.

## Status

`versioncam` is on [npm](https://www.npmjs.com/package/versioncam), and the
[changelog](packages/recorder/CHANGELOG.md) says what each version changed.
The manual is [`packages/recorder/README.md`](packages/recorder/README.md),
the same text as the docs at [version.cam](https://version.cam). The clip
language is described in [`dsl.md`](packages/recorder/dsl.md). This
repository holds the recorder and the example app, which its own CI records
on every push to `main`. It was private until 2026-10-28. Please report bugs,
questions, and apps it cannot record in the
[issues](https://github.com/versioncam/versioncam/issues). If a clip will not
reproduce, attach the two pictures that `versioncam stability` saves. That
makes it much easier for us to help.

## Layout

| Path | What |
|---|---|
| `packages/recorder` | the `versioncam` package: driver, capture gate, renderer, encoder, CLI, and `plugin/`, the authoring skill and its reviewer |
| `examples/demo-app` | a deliberately boring Vite app with three clips. It shows the package works when an app installs it like any other dependency, and CI records it on every push |
| `scripts/` | the headless evaluation harness for the authoring skill, run from a plain terminal |

## Develop

```bash
npm ci && npm run build && npm run typecheck && npm run lint && npm test
npx versioncam install --with-deps && npm run test:integration
```

CI runs the same commands, then checks, records and renders the example's
clips. [`CLAUDE.md`](CLAUDE.md) has the conventions, for people and agents
alike. Every sentence a user reads follows [`docs/voice.md`](docs/voice.md).

## Licence

Versioncam is under the Functional Source License, version 1.1, with Apache
2.0 as its future licence (`FSL-1.1-ALv2`). Use it on your own apps and in
your own CI, commercial work included, and change it as you need. The
licence does not allow you to make it available to others in a product or
service that competes with it. Each version becomes Apache 2.0 two years
after its release, so 0.7.7, released on 2026-11-09, becomes Apache 2.0 on
2028-11-09.
[`LICENSE.md`](LICENSE.md) is the licence. The
[GitHub Action](https://github.com/versioncam/action) and the
[website](https://github.com/versioncam/versioncam-home) are MIT, in their
own repositories.
