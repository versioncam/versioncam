# Versioncam

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

The recorder is the `versioncam` package, in `packages/recorder`: record,
render, check in CI, prove an app records the same way twice, and an agent
skill — `npx versioncam init`, then `/versioncam "<intent>"` — that sets a
repository up on its first run and writes, records and reviews a clip from one
sentence. It began inside the PathGen frontend repo
([PR #313](https://github.com/PathGen-AI/frontend/pull/313)), which is now its
first consumer. The [plan](docs/plan.md) says what comes next, in order, with
what has to be true at each step; the `docs/wp*.md` files are the work
packages as executed.

Nothing is published yet. The repository stays closed and the npm package will
be public; the licence text is still to be chosen — see the plan.

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

## Layout

```
packages/recorder   the versioncam package: driver, renderer, encoder, CLI, config boundary,
                    and plugin/ — the authoring skill and its reviewer
examples/demo-app   a deliberately boring app with clips, for tests and for showing it off
docs/plan.md        the execution plan; docs/wp*.md, each work package as executed
scripts/            the headless evaluation harness, run from a plain terminal
```

A GitHub Action around `versioncam check` and `render` is the next work
package, WP7.
