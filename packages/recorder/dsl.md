# The clip DSL

Everything a clip body can call on its session, `s`, with every option and its
default. A test holds this page and the session's code to the same list: a
method here exists, and a method that exists is here.

Three rules hold across the whole surface:

- **Every `await` spends clip time and captures frames.** `hold`, `click`,
  `type` and the rest advance the authored clock.
- **A track write spends none.** `camera.*`, `highlight` and `caption` write
  at the current instant and return at once. Each needs frames after it, from
  a `hold` or the next action, or it is never seen.
- **Target by test id or role, never by coordinates.** A clip built from
  locators survives a layout change. One built from points does not.

Durations are in milliseconds, except a caption's, which are in seconds. A
point is `[x, y]` in viewport pixels, and a rect is `{ x, y, w, h }`.

## Locators

A locator resolves when it is used, not when it is written. It waits up to 15
seconds for its element to be visible. A locator that matches several
elements is an error that names the count: narrow it rather than reaching for
the first match.

### `byTestId(testId)`

First choice. `data-testid` is the only handle an app can promise a clip.

### `byRole(role, options?)`

Second choice, and how a person would describe the control:
`byRole("button", { name: "Save" })`. The options are Playwright's for
`getByRole`.

### `byLabel(text)`

A form field, by its label or its `aria-label`.

### `byPlaceholder(text)`

A field with no label but a placeholder.

### `byText(text)`

Content rather than a control, by a string or a regular expression. The
locator most likely to match twice.

### `css(selector)`

The escape hatch. A CSS selector is a claim about markup, which is the thing
most likely to change.

## Time

### `hold(ms)`

Stay still and keep capturing. It is the pause that makes a beat readable,
and what a track write needs after it.

### `settle(options?)`

Wait for the page to stop working: the DOM quiet, no requests in flight, the
fonts loaded, no CSS transition still running, and whatever `settle.ready` in
the config adds. It advances the page's clock without capturing, so the wait
never reaches the video.

Give every beat a `label`. `versioncam review` checks a beat sheet against the
labels, and `sheet --at-marks` samples the frames they mark. A settle that
reaches `timeoutMs` warns and carries on, so the clip still records, and
`review` fails it.

| Option | Default | What it sets |
|---|---|---|
| `label` | none | The beat this wait marks. |
| `quietMs` | the config's, `150` | How long the page must stay quiet, on its own clock. |
| `timeoutMs` | the config's, `15000` | Real time to wait before giving up. |
| `yieldMs` | the config's, `20` | Real time yielded per tick, so the network and the renderer can work. |
| `hook` | the config's `settle.ready` | `() => Promise<boolean>`, one more condition, for this wait only. |

### `offCamera(fn)`

Run raw Playwright with nothing captured and no time spent: mocking an API,
seeding data, priming a conversation. `fn` gets the Playwright `Page`, which
is also `s.page`, and `offCamera` returns what `fn` returns. The page's clock
does not move either. Whatever the app needs time to finish after `fn`, a
`settle` gives it.

## Navigation

### `open(path, options?)`

Go to `baseUrl` plus `path`, or to `path` itself when it is a full URL. Then
sign in, if the config's `auth` has a `login` hook, settle, and capture frame
0. Every clip starts here.

| Option | Default | What it sets |
|---|---|---|
| `settleTimeoutMs` | `90000` | How long the first settle may take, for an app that boots slowly. |

## Pointer

A target is a locator or a point. The cursor travels to it along a curved
path, timed by Fitts's law: longer for a far or small target.

### `moveTo(target, options?)`

Glide to a locator or a point without pressing.

| Option | Default | What it sets |
|---|---|---|
| `duration` | from distance and size | How long the move takes. |

### `hover(target, options?)`

Move there and stay, the way a person does before reading a tooltip.

| Option | Default | What it sets |
|---|---|---|
| `dwell` | `220` | How long to stay once there. |
| `duration` | from distance and size | How long the move takes. |

### `click(target?, options?)`

Approach, dwell, press, release. With no target it clicks where the cursor
already is. The press lasts 70 to 100 milliseconds, seeded.

| Option | Default | What it sets |
|---|---|---|
| `dwell` | `80` to `150`, seeded | How long to rest on the target before pressing. |

### `drag(target, from, to, options?)`

Press, draw a straight stroke, release. For a control that answers a stroke
and ignores a click: a brush, a slider, a range handle. `target` is a locator
or a rect. `from` and `to` are fractions of its box, written `{ x, y }`, so
the drag survives a layout change: `{ x: 0.18, y: 0.5 }` to
`{ x: 0.36, y: 0.5 }` crosses the middle.

Mind the edges. A chart's axis labels live inside its own box, and a drag
that starts at x 0.08 selects that text instead of the control.

| Option | Default | What it sets |
|---|---|---|
| `duration` | `1400` | How long the stroke takes, from press to release. |
| `modifiers` | none | Keys held through the stroke: `["Shift"]`, `["Alt"]`, or both. |

### `lasso(target, planner, options?)`

Press, follow a smoothed closed loop, release. The planner comes from
`loop([[0.3, 0.3], …])`, exported beside `clip`, and its points are fractions
of the target's box, so the stroke survives a layout change. Find the
fractions with `versioncam measure <path> <selector>`.

A frame from partway through the stroke looks wrong, and is not. The
smoothing curves outside the points it passes through, so a half-drawn loop
swings wide of what it is about to enclose before it comes back. Judge the
selection from a frame after the loop closes.

| Option | Default | What it sets |
|---|---|---|
| `duration` | `1400` | How long the stroke takes, from press to release. |
| `modifiers` | none | Keys held through the stroke: `["Shift"]`, `["Alt"]`, or both. |

## Keyboard

### `typeInto(target, text)`

Click the field, then type. This is almost always what you want: without the
click, the keystrokes go wherever focus happens to be.

### `type(text)`

Type into whatever has focus, at a human cadence: about 55 milliseconds a key,
varied, with a longer pause after a space or punctuation.

### `press(key)`

One key, at once: `"Enter"`, `"Escape"`, `"Meta+a"`.

## Camera, highlight, caption

None of these spends clip time, so each needs frames after it.

Each camera line starts from wherever the camera is, still or moving, and
eases into its new framing over its `duration`. A line written while the
camera is still on its way somewhere takes over from there at once. Two
written at the same instant are one: the second.

### `camera.zoom(target, scale?, options?)`

Frame a locator or a rect, padded by 12% of its size on each side, and keep
the frame inside the page even at its edge.

`scale` is a **ceiling, not a multiplier**. It caps how far in the camera may
go: the frame is never narrower than `viewport.width / scale`. So a small
target does not fill the frame. At 1440 wide, `zoom(x, 1.7)` still shows
about 850 pixels of page, which for a 310-pixel card reads as barely zoomed.
For a target that dominates the shot, pass a rect from `versioncam measure` to
`camera.to` instead.

The default, 1.5, is as far in as the camera goes before captured pixels are
upscaled, for a 1440-wide page captured at 2× into a 1920-wide video. Past
it, the zoom softens.

| Option | Default | What it sets |
|---|---|---|
| `scale` | `1.5` | The most the camera may magnify. |
| `duration` | `1100` | How long the camera takes to get there. |

### `camera.to(rect, options?)`

Frame an exact rectangle, in viewport pixels.

| Option | Default | What it sets |
|---|---|---|
| `duration` | `1100` | How long the camera takes to get there. |

### `camera.reset(options?)`

Back to the whole viewport. Ending a clip on this and nothing after it is the
classic mistake, and `versioncam review` warns about it.

| Option | Default | What it sets |
|---|---|---|
| `duration` | `1100` | How long the camera takes to get there. |

### `camera.follow(options?)`

Follow the cursor at one scale until the next camera line. For a clip that
moves around the page, one `follow` does what a `zoom` before each thing the
cursor uses cannot: the camera stays at one scale and moves with the cursor
without stopping.

The camera keeps the cursor inside a dead zone in the middle of the frame and
moves only when the cursor leaves it, so a move to the next field of a form
does not move the picture. It never shows beyond the page's edge, and never
overshoots. Its path is worked out from the whole cursor track once the clip
has run, so it sets off with the cursor rather than trailing behind it.

It starts centred on the cursor, easing in from wherever the camera was. The
next `zoom`, `to`, `reset` or `follow` eases out of it the same way.

| Option | Default | What it sets |
|---|---|---|
| `scale` | `1.35` | How far in. Unlike a zoom's, it is exact: the frame is `viewport.width / scale` wide the whole time. |
| `deadZone` | `0.3` | The share of the frame, around its middle, the cursor can move in without moving the camera. `0` answers every movement. |
| `smoothing` | `600` | How softly the camera moves, in milliseconds: about how long it takes over a move the cursor makes at once. Larger is softer. |
| `duration` | `1100` | How long the camera takes to get from where it was into the follow. |

The defaults are `followZoom`, `followDeadZone`, `followSmoothingMs` and
`zoomDurationMs` in the config's `motion`, so an app can set its own.

### `camera.release()`

Stop following. The camera comes to rest on the framing it was heading for,
with the cursor in it, and stays there until the next camera line. When the
camera is not following, it does nothing.

### `highlight(target, style, options?)`

A `"ring"` around a locator or a rect, or a `"spotlight"` on it, drawn at
output resolution. A locator is measured once, when the line runs: the
highlight stays where the element was.

| Option | Default | What it sets |
|---|---|---|
| `for` | `1800` | How long the highlight stays up. |

### `caption(text, options?)`

A line of text from now until the next caption, or the end of the clip. It
starts where it is written, so a second caption mid-clip replaces the first
rather than doubling over it.

| Option | Default | What it sets |
|---|---|---|
| `from` | now | When the caption appears, in seconds. |
| `to` | the next caption | When it goes, in seconds. |

## What the runner reads

These are for the CLI, not for clips.

### `cost`

Where the wall-clock time of this recording went.

### `settles`

Every settle so far, as written to `settles.json`.

### `at`

How far the clip has got, as `{ frame, t }`.
