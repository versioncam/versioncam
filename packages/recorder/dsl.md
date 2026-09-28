# The clip DSL

Everything a clip body can call on its session, `s`. `test/dsl.spec.ts`
asserts that this list and `RecordingSession` name exactly the same members, so
a method here exists and a method that exists is here. The README promised an
`s.drag` for months while there was none; there is one now, because a clip that
needed it had been silently doing nothing instead.

Three rules the whole surface follows:

- **Every `await` spends clip time and captures frames.** `hold`, `click`,
  `type` and the rest advance the authored clock.
- **A track write spends none.** `camera.*`, `highlight` and `caption` write at
  the current instant and return immediately, so each one needs frames after it
  — a `hold` or the next action — or it is never seen.
- **Target by role or test id, never by coordinates.** A clip built from
  locators survives a layout change; one built from points does not.

## Locators

They resolve when used, not when written, and wait up to 15 seconds for the
element to be visible. A locator that matches several elements is an error
naming the count — narrow it rather than reaching for the first match.

- `byTestId(testId)` → `Locator` — first choice: `data-testid` is the only
  handle an app can promise a clip.
- `byRole(role, options?)` → `Locator` — second choice: `byRole("button", { name: "Save" })`
  is how a person would describe it.
- `byLabel(text)` → `Locator` — a form field, by its label.
- `byPlaceholder(text)` → `Locator` — a field with no label but a placeholder.
- `byText(text)` → `Locator` — content, not controls, and the one most likely
  to match twice.
- `css(selector)` → `Locator` — the escape hatch; a CSS selector is a claim
  about markup, which is the thing most likely to change.

## Time

- `hold(ms)` — stay still and keep capturing. The pause that makes a beat
  readable, and what a track write needs after it.
- `settle(options?)` — wait for the page to stop working: DOM quiet, no
  requests in flight, fonts loaded, and whatever `settle.ready` adds. Advances
  the page's clock without capturing, so the wait never reaches the video.
  `{ label }` is what `versioncam review` checks a beat sheet against, and what
  `--at-marks` samples, so give every beat one. Also takes `{ quietMs,
  timeoutMs, yieldMs, hook }`.
- `offCamera(fn)` — run raw Playwright with nothing captured and no time spent:
  mocking an API, seeding data, priming a conversation. `fn` is given the
  Playwright `Page`, which is also `s.page` if you need it directly. No time
  on the page's clock either: what the app needs time to finish after `fn`,
  a `settle` gives it.

## Navigation

- `open(path, options?)` — go to `baseUrl + path`, sign in if the config says
  how, settle, and capture frame 0. Every clip starts here. `{ settleTimeoutMs }`
  for an app that boots slowly; the default is 90 seconds.

## Pointer

- `moveTo(target, options?)` — glide to a locator or a point, `[x, y]` in
  viewport pixels, without pressing.
  `{ duration }` overrides the Fitts-law timing.
- `hover(target, options?)` — move there and stay, the way a person does before
  reading a tooltip. `{ dwell, duration }`.
- `click(target?, options?)` — approach, dwell, press, release. Called with no
  target it clicks where the cursor already is. `{ dwell }`.
- `drag(target, from, to, options?)` — press, draw a straight stroke, release.
  `from` and `to` are fractions of the target's own box, so the drag survives a
  layout change: `{ x: 0.18, y: 0.5 }` to `{ x: 0.36, y: 0.5 }` crosses the
  middle. For a control that answers a stroke and ignores a click — a brush, a
  slider, a range handle. Mind the edges: a chart's axis labels live inside its
  own box, and a drag starting at x 0.08 selects that text instead of the
  control. `{ duration, modifiers }`.
- `lasso(target, planner, options?)` — press, follow a smoothed closed loop,
  release. The planner comes from `loop([[0.3, 0.3], …])`, exported beside the
  session, and is written in fractions of the target's box, so the stroke
  survives a layout change. Measure first: `versioncam measure <path> <selector>`.
  `{ duration, modifiers }`.
  A frame taken partway through the stroke looks wrong, and is not: the
  smoothing curves outside the points it passes through, so a half-drawn loop
  swings wide of the thing it is about to enclose before coming back. Judge the
  selection from a frame after the loop closes, not from the middle of it.

## Keyboard

- `typeInto(target, text)` — click the field, then type. What you want almost
  always: without the click the keystrokes go wherever focus happens to be.
- `type(text)` — type at a human cadence into whatever has focus.
- `press(key)` — one key, immediately. `"Enter"`, `"Escape"`, `"Meta+a"`.

## Camera, highlight, caption

None of these spends clip time. Each needs frames after it.

- `camera.zoom(target, scale?, options?)` — frame a locator or a rect, padded,
  keeping the target inside the frame even at the edge of the page.
  `scale` is a **ceiling, not a multiplier**: it caps how far in the camera may
  go (the frame is never narrower than `viewport.width / scale`), and the
  default cap of 1.65 exists so a captured pixel is never upscaled. A small
  target does not fill the frame as a result — at 1440 wide, `zoom(x, 1.7)`
  still shows about 850 pixels of page, which for a 310-pixel card reads as
  barely zoomed at all. If you want the target to dominate the shot, pass a
  rect from `versioncam measure` to `camera.to` instead.
- `camera.to(rect, options?)` — frame an exact rectangle in viewport pixels.
- `camera.reset(options?)` — back to the whole viewport. Ending a clip on this
  and nothing else is the classic mistake: `versioncam review` warns about it.
- `highlight(target, style, options?)` — `"ring"` around it or `"spotlight"` on
  it, drawn in post at output resolution. `{ for }` in milliseconds.
- `caption(text, options?)` — a line of text from now until the next caption or
  the end of the clip. It starts where it is written, so a second caption
  mid-clip replaces the first rather than doubling over it. `{ from, to }` in
  seconds to place it by hand.

## What the runner reads

Not for clips; the CLI reports them.

- `cost` — where the wall-clock time of this recording went.
- `settles` — every settle so far, as written to `settles.json`.
- `at` — how far the clip has got, as `{ frame, t }`.
