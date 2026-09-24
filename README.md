# versioncam

Demo clips as a build product.

A clip of your app is a script: declare the beats, drive the real UI through
its own controls, capture, composite, encode. Run it again after every deploy.
When the UI changes in a way the clip depends on, the clip fails — naming the
control it could not find and the second it gave up — instead of quietly
shipping a video that is wrong. An LLM writes and repairs the scripts, in a
loop with visual feedback, from a sentence of intent.

Screen recorders give you a good-looking clip once. This gives you clips that
stay true.

## Status

Prototype. The recorder exists and works, inside the PathGen frontend repo
([PR #313](https://github.com/PathGen-AI/frontend/pull/313)): six clips of a
live surveillance app, byte-identical across runs, plus the renderer, the
encoder and the test suite. This repo is where it becomes a product. The
[plan](docs/plan.md) says how, in order, with what has to be true at each step.

Nothing here is public yet, and the licence decision is deliberately open —
see the plan.

## The idea in one paragraph

Time is **authored, not measured**. A script declares the timeline; the driver
steps the app through it one output frame at a time, advancing the page's
fake clock by exactly 1/fps and capturing. Anything slow — a query, a tile, a
model — happens inside a *settle* that advances the clock but captures
nothing, so it never reaches the video. The cursor is real input with a
synthetic glyph: the driver moves the actual mouse so hover and press states
genuinely fire, and draws the pointer in post at output resolution. Zoom and
pan are keyframes applied to frames captured at 2× device pixels. Two runs
produce the same bytes, and the tests assert that rather than hoping.

## Layout (intended)

```
packages/recorder   the core: driver, renderer, encoder, CLI, config boundary
packages/author     the LLM loop: inspect → plan → script → record → review → fix
packages/action     GitHub Action: record on preview deploys, post sheets on PRs
examples/           a small app with clips, for tests and for showing it off
docs/plan.md        the execution plan
```
