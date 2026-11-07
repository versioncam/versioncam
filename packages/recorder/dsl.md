# The clip DSL

Everything a clip body can call on its session, `s`, with every option and its
default. A test checks that this page and the session's code list the same
methods: every method here exists, and every method that exists is here.

Three rules apply everywhere:

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
elements is an error that names the count. Narrow it rather than reaching for
the first match.

### `byTestId(testId)`

First choice. A `data-testid` is the only target an app can promise to keep
the same for its clips.

### `byRole(role, options?)`

Second choice, and how a person would describe the control:
`byRole("button", { name: "Save" })`. The options are Playwright's for
`getByRole`. A name matches any part of the control's name, ignoring case, so
`{ name: "Tutorial" }` also finds "Read the tutorial". Add `{ exact: true }` to
match the whole name.

### `byLabel(text)`

A form field, by its label or its `aria-label`.

### `byPlaceholder(text)`

A field with no label but a placeholder.

### `byText(text)`

Content rather than a control, by a string or a regular expression. It is the
locator most likely to match twice.

### `css(selector)`

The escape hatch. A CSS selector is a claim about markup, which is the thing
most likely to change.

## Time

### `hold(ms)`

Stay still and keep capturing. It is the pause that makes a beat readable,
and what a track write needs after it.

### `settle(options?)`

Wait until the page is idle: the DOM quiet, no requests in flight, the
fonts loaded, no CSS transition still running, and whatever `settle.ready` in
the config adds. It advances the page's clock without capturing, so the wait
never reaches the video. A new document that loads from a link or a form post
is part of the wait, and may take up to 90 seconds.

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
does not move either. If the app needs time to finish something after `fn`,
a `settle` gives it that time.

## Navigation

### `open(path, options?)`

Go to `baseUrl` plus `path`, or to `path` itself when it is a full URL. Then,
if the config's `auth` has a `login` hook, sign in. Then settle and capture
frame 0. Every clip starts here. A later `open` goes to another page, and the
clip carries on from where it is. The video cuts to the new page once it has
finished loading.

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
| `modifiers` | none | Keys held through the press: `["Shift"]` for a shift-click, `["Meta"]`, `["Alt"]`, `["Control"]`. |

### `drag(target, from, to, options?)`

Press, draw a straight stroke, release. Use it for a control that responds to
a stroke and ignores a click: a brush, a slider, a range handle. `target` is a locator
or a rect. `from` and `to` are fractions of its box, written `{ x, y }`, so
the drag survives a layout change: `{ x: 0.18, y: 0.5 }` to
`{ x: 0.36, y: 0.5 }` crosses the middle.

Mind the edges. A chart's axis labels live inside its own box, and a drag
that starts at x 0.08 selects that text instead of the control.

`drag(from, to, options?)` is the other form: from one thing to another,
each a locator or a point, such as a file onto a dropzone or a card onto a
column. The recorder tells the two forms apart by the second argument: a
locator or a point in this form, and a fraction `{ x, y }` in the first form.

| Option | Default | What it sets |
|---|---|---|
| `duration` | `1400` | How long the stroke takes, from press to release. |
| `modifiers` | none | Keys held through the stroke: `["Shift"]`, `["Alt"]`, `["Meta"]`, `["Control"]`. |

### `lasso(target, planner, options?)`

Press, follow a smoothed closed loop, release. The planner comes from
`loop([[0.3, 0.3], …])`, exported beside `clip`, and its points are fractions
of the target's box, so the stroke survives a layout change. Find the
fractions with `versioncam measure <path> <selector>`.

A frame from partway through the stroke looks wrong, but it is not. The
smoothing curves outside the points it passes through, so a half-drawn loop
swings wide of what it is about to enclose before it comes back. Judge the
selection from a frame after the loop closes.

| Option | Default | What it sets |
|---|---|---|
| `duration` | `1400` | How long the stroke takes, from press to release. |
| `modifiers` | none | Keys held through the stroke: `["Shift"]`, `["Alt"]`, or both. |

### `scroll(target, where, options?)`

Scroll a pane, or the page, on the clip's clock: one eased step a frame, so
the frames inside the scroll are the same on every run. `target` is the
element that scrolls, as a locator, or `"page"` for the document. `where` is
one of three:

- `{ by: px }` from where it is now: `{ by: 400 }` goes down, `{ by: -400 }`
  back up.
- `{ to: "top" | "bottom" | px }` to one end, or to an offset.
- `{ into: locator, block? }` until that element sits at the `"start"`,
  `"center"` or `"end"` of the pane's visible box. The default is
  `"center"`.

The end is clamped to what the element can scroll, and the recording keeps
the end it reached. The recorder refuses an element with nothing to
scroll. It is nearly always a wrapper around the one that scrolls, which `inspect` shows.

The cursor stays where it is. For a scroll that reads as a mouse wheel, move
the cursor over the pane first. Never scroll with `offCamera` and
`scrollIntoView` or `mouse.wheel`: the browser animates those on its own
clock, and the frames inside them differ between runs. While recording, a
page's own smooth scrolling, from its stylesheet or from its script, is
instant.

| Option | Default | What it sets |
|---|---|---|
| `duration` | `700` | How long the scroll takes. Two frames at the least. `motion.scrollDurationMs` sets the default. |
| `axis` | `"y"` | `"x"` scrolls sideways. `"top"` is then the left end and `"bottom"` the right. |

### `fileWindow(files, options?)`

Draw a file window over the page, listing `files`, to drag onto the app's
dropzone. The browser's own file dialog is outside the page, and nothing can
film it. It looks like a Finder window. Returns `{ item(i), close() }`:
`item(i)` is row `i` as a locator, for `click`, `hover` and `drag`.

```ts
const files = await s.fileWindow(
  [{ name: "cases.csv", content: csv }, { name: "sites.csv", content: sites }],
  { title: "Case data" },
);
await s.click(files.item(0));
await s.click(files.item(1), { modifiers: ["Shift"] });
await s.drag(files.item(0), s.byTestId("dropzone"), { duration: 1000 });
```

A click selects one row, a click with Shift extends to it, and one with
Meta adds or removes it. A press on a selected row drags the whole
selection, and letting go over the page sends the element under the pointer
the drag events a real drag sends, carrying the files as `File` objects, so
the app takes them through its own dropzone. The window then closes. A file
is `{ name, content?, type?, size? }`. Unless you give them, the type and the
Size and Kind columns follow from the name and the content. versioncam draws
the window; it is not the operating system's real one, so say so wherever the
clip is shown.

| Option | Default | What it sets |
|---|---|---|
| `title` | `"Files"` | The title bar. |
| `at` | `{ x: 0.52, y: 0.42 }` | The window's top left corner, as fractions of the viewport. |

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
camera is still on its way somewhere takes over from there at once. If two
are written at the same instant, only the second counts.

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

Back to the whole viewport. Ending a clip on this with nothing after it is a
common mistake, and `versioncam review` warns about it.

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
| `deadZone` | `0.3` | The share of the frame, around its middle, the cursor can move in without moving the camera. `0` follows every movement. |
| `smoothing` | `600` | How softly the camera moves, in milliseconds: roughly how long the camera takes to catch up when the cursor jumps to a new place in one move. Larger is softer. |
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
