# Versioncam

Short, true product videos, recorded by your CI.

A clip of your app is a script in your repository. The recorder drives the
real UI through its own controls in a real browser, on an authored clock,
and captures what the page shows; then it draws a cursor and a camera over
the frames and encodes a video. Run it again after every deploy. When the
app changes under a clip, the clip fails, naming the control it could not
find and the second it gave up, instead of quietly shipping a video that is
wrong. A coding agent writes and repairs the scripts from a sentence of
intent, and a reviewer judges the result from a contact sheet.

Screen recorders give you a good-looking clip once. This gives you clips
that stay true.

## Install

```bash
npm i -D versioncam
npx versioncam install       # the Chromium this version records with
npx versioncam init          # the authoring skill, into .claude/
```

The manual is [`packages/recorder/README.md`](packages/recorder/README.md),
the same text as the docs at [version.cam](https://version.cam); the clip
language is [`dsl.md`](packages/recorder/dsl.md). In CI, the
[GitHub Action](https://github.com/versioncam/action) runs `versioncam check`
and comments on a pull request when a clip breaks.

## Status

`versioncam` 0.5.1 is on [npm](https://www.npmjs.com/package/versioncam);
the [changelog](packages/recorder/CHANGELOG.md) says what each version
changed. This repository is the recorder and the example app that its own CI
records on every push to `main`. It was private until 2026-10-28 and is now
where the recorder is developed. The hosted layer at version.cam, which keeps
clips at an address after CI has made them, is a separate service and is not
published.

Bugs, questions, and apps it cannot record go to the
[issues](https://github.com/versioncam/versioncam/issues). A clip that will
not reproduce is easiest to help with alongside the two pictures
`versioncam stability` saves.

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
after its release: 0.5.1, released 2026-10-11, on 2028-10-11.
[`LICENSE.md`](LICENSE.md) is the licence. The
[GitHub Action](https://github.com/versioncam/action) and the
[website](https://github.com/versioncam/versioncam-home) are MIT, in their
own repositories.
