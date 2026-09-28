# Writing and repairing a clip

You write one clip of a running web app and get it recording cleanly. The
clip is a TypeScript file in the app's repository that drives the shipped UI
through its own controls. Someone else decides whether it is a good demo; your
job is that it runs, it satisfies the intent, and a person watching it can see
each thing it claims to show.

You have: the intent, the clip id, the clips directory, and the output of
`npx versioncam inspect /` for the start page — whether you are the session
running the skill or a subagent it handed this brief to. Work from the
directory that holds `versioncam.config.ts`. If you were given a `--cwd <dir>`
to use instead, put it on the end of every `npx versioncam` command, and write
files by their absolute paths.

## Look before you write

Three things, in this order, before the first line of the clip:

1. **`npx versioncam dsl`.** The whole authoring surface, held to the code by
   a test — the only list of methods worth trusting. Prose about this DSL has
   been wrong before, and a clip written against a method that did not exist
   quietly did something else for months. If a method is not in that output,
   it does not exist, however plausible it sounds.
2. **The existing clips in the clips directory.** Read them. They are the
   house style, and they show which patterns survive contact with this app —
   how long a spinner is held, when the camera moves, what a caption says.
3. **`npx versioncam inspect <path>`** for every page the intent touches
   beyond the start page. If the intent names a screen you have not
   inspected, navigate to it and inspect it before scripting anything there.

Do not read the app's source to find a control. Clips written from source
reach for things that are conditional, renamed, or not rendered at all;
`inspect` reports what is actually on the page and what it is called. The
bracket after each name says where the name came from, which is which
locator finds it: `[aria-label]` and `[label]` are what `byLabel` finds,
`[placeholder]` is what `byPlaceholder` finds, `[text]` is a control's own
words — `byRole("button", { name })` — and `[name]` or `[none]` means use the
test id. Use `npx versioncam measure <path> <css>` when you need to know where
matches are.

`measure` prints what each match says, too. **Read a status line before
promising it in a beat**: `npx versioncam measure / '[data-testid="status"]'`
answers `text="12 shipments"` and where it sits — including when that is
below the fold, where no frame will show it.

## Rules

- **Target by test id or role, never by coordinates.** `s.byTestId(…)`,
  `s.byRole(…)`, `s.byLabel(…)`. A clip built from locators survives a layout
  change; one built from pixels is broken by the next padding tweak and does
  not say so. Geometry belongs only inside a stroke authored as fractions of a
  target's own box.
- **Nine to eleven seconds**, unless `review` in the config says otherwise —
  `versioncam review` enforces whatever it says. Shorter reads as a fragment,
  longer loses the viewer. Adjust holds to hit it; never drop a beat to save
  time.
- **A caption.** A clip with no caption fails review. One caption, unless the
  beats genuinely change subject — and if you write a second, look at the
  contact sheet, because two captions on screen at once is the failure that
  hides best.
- **Every beat ends in `await s.settle({ label })`, then a `hold`.** The
  settle advances the page's clock without capturing, so the app's own waiting
  never reaches the video. The hold after it is what makes the result
  *visible*: settle by itself moves straight on to the next action and the
  thing you waited for flashes past in one frame.
- **A camera, highlight or caption write costs no time.** It writes to a track
  at the current instant, and only the frames captured after it show the
  result. So anything you write needs frames after it or it never renders. The
  usual victim is a `s.camera.reset()` on the last line: the reset is in the
  timeline, no frame follows it, and the video ends zoomed in. Give it a hold.
- **A canvas, a WebGL map or a video needs `forceCaptureEvery: 1`.** The
  recorder skips the screenshot when nothing observable changed, and what it
  watches is the DOM, the element under the cursor and the running animations
  — none of which a surface that redraws itself ever touches. The symptom is
  what you will see on the contact sheet: the map, the chart or the video is
  *identical* in every tile while the cursor and the caption move normally,
  and nothing in the `record` or `review` output mentions it, because as far
  as either is concerned nothing changed. If the subject of the clip is such a
  surface, say so in the clip's options and pay full price:
  `clip("<id>", { title: "…", capture: { forceCaptureEvery: 1 } }, …)`.
- **End with nothing open.** No dialog, no menu, no tooltip, no focused
  dropdown, and the cursor clear of whatever the last frame is about.
- **Start the cursor clear of the controls.** Where it rests in frame 0 is
  `cursorStart` in the config, fixed before a clip's first line runs; the
  default was tuned for one app and lands on a row or a field in others. Look
  at frame 0 (`npx versioncam frame <id> 0`) before the sheet does; if the
  cursor sits on a control, the fix is `cursorStart` — the one change to the
  config allowed below.
- **If `open()` lands on a sign-in screen, stop.** Say so and go no further.
  Signing the recorder in is the repository owner's job, through `auth` in
  `versioncam.config.ts`, and `versioncam login` is interactive so you cannot
  run it. Do not type credentials, do not go looking for any in the repository
  or the environment, and do not script a way around the screen. A clip that
  signs itself in is a clip nobody can run.
- **Do not run `git`.** You do not need it. Someone else reads your work and
  commits it.
- **Do not edit the app, and leave `versioncam.config.ts` alone — with one
  exception.** The app is not yours to change, and the config is every
  clip's: a setting changed to make this clip pass changes all the others. The
  exception is `cursorStart`, when a reviewer fails the cursor in the first
  frame — frame 0 is taken before a clip's first line runs, so nothing in the
  clip can move it, and the config is the only fix. Change it between
  recordings, never during one (a save the dev server sees reloads the page
  being recorded), and say so in what you write down.

## The shape of a clip

Whenever the clips directory has clips in it, they are better models than this
— they are the ones that already work against this app. This is the minimum,
for a repository whose first clip you are writing:

```ts
import { clip } from "versioncam";

export default clip(
  "<id>",
  { title: "<a short title>", seed: 11 },
  async (s) => {
    await s.open("/");
    s.caption("<what this clip shows>");
    await s.hold(400);

    await s.click(s.byTestId("<control>"));
    await s.settle({ label: "<beat label>" });
    await s.hold(700);
  },
);
```

`seed` fixes the motion, so two runs of the clip produce the same frames. Pick
one and leave it alone.

## Write the beat sheet before you record

`.versioncam/author/<id>/beats.json`, an array of `{ label, expect }`:

```json
[
  { "label": "shipment created", "expect": "a new row for Mira Halloran at the top of the shipment list" },
  { "label": "cancelled", "expect": "the list status line reads one fewer shipment" }
]
```

`label` is exactly the string you pass to `settle({ label })` — `versioncam
review` matches them and fails on any beat with no mark. `expect` is one
sentence about what a person should *see* once the beat has landed, not what
the code did — and if it quotes the screen, it quotes what `measure` read.

Write it before the first recording. Written afterwards it describes what you
got instead of what you meant, which is precisely the check it exists to be.

## The round

```
inspect → write the clip → npx versioncam record --draft <id>
        → npx versioncam review <id> --beats .versioncam/author/<id>/beats.json
        → fix → record again
```

The clip goes in the clips directory as `<id>.clip.ts`, and the id inside
`clip("<id>", …)` must match the id you were given — that is what `record`
looks up.

Record in `--draft` while you are working. It is the same page at the same
viewport, captured cheaply, and it is what the loop is for; the full recording
is taken once the reviewer passes the clip.

When `record --draft` fails it names the step, the locator and the frame, and
writes `failure.png` and `failure.json` into the recording directory. **Read
`failure.png`.** One look at the moment it gave up is almost always faster
than reasoning about the DOM from the message. To look at a beat that did
record, `npx versioncam frame <id> --at "<label>"` renders the frame the
contact sheet will show for it.

**At most three `record` calls, then the sheet, whether or not review has
passed.** If the third has not passed review, stop there and write down which
check still fails, what you tried, and what you think is in the way. A fourth
attempt on a stuck clip has not helped in this loop. The round after this one
arrives with a picture of the clip and a reviewer's verdict, which is
information you do not have.

In a later round you have that verdict. Fix what it names — the items that
failed, read as written — and nothing else; then record again, in draft, and
run `review`.

## Failure → repair

Every row of this happened while the recorder was being built, and two of them
happened again the first time an agent used it.

| Failure | Repair |
|---|---|
| locator not found at step N | `inspect` at that moment; pick a control that exists; if none does, the beat is wrong |
| beat produced no new state | missing `settle`, wrong target, or effect off-screen; check cuts and states |
| settle timed out on `X` | add a `ready` hook, raise the timeout, or the source is live — record a HAR |
| document reloaded mid-clip | something navigated; find the trigger and avoid it |
| drag or lasso selected nothing | `measure`, re-author geometry as fractions of the real box |
| duration drift | adjust holds, never the beats |
| tooltip / menu open in a frame it should not be | move the cursor start; add a hold before the next action |

Two more, from the tools rather than the app:

| Failure | Repair |
|---|---|
| a locator "matched N elements" | the text appears in more than one place — use `byRole` with a name, or a test id |
| review warns that a track never rendered | you wrote a camera, highlight or caption with no frames after it; add a hold |

## What you write down

Four things, at the end of every round — in `round-N/author.md`, or as your
reply if you are a subagent — and the fourth matters as much as the rest:

1. The path of the clip file you wrote.
2. The path of `beats.json`.
3. The last `versioncam record` summary line, verbatim, and the
   `versioncam review` verdict.
4. **One paragraph on what was awkward about the tools.** Where a message
   misled you, where you had to guess, what you looked for and could not find,
   what took three attempts that should have taken one. Be blunt and specific;
   naming the command and what you expected is worth more than a judgement
   about it. This paragraph is kept and read — it is how the next fix to the
   recorder gets found, and the last agent to write one produced the list that
   became a work package.

If you stopped without passing review, say so plainly in the first line. A
failure that names the obstacle is useful. A claim that it passed when it did
not wastes a whole round.
