import { frameAt } from "../core/timeline.js";
import { evalCamera } from "../core/camera.js";
import type { Rect, Timeline } from "../core/timeline.js";
import type { SettleReport } from "../driver/settle.js";

/**
 * The half of reviewing a clip that needs no eyes.
 *
 * Whether the beats happened, whether anything changed between them, whether a
 * wait gave up, whether a track was written somewhere no frame will ever show
 * it — all of that is in the recording, and none of it needs a picture. What
 * does need a picture (is the thing legible, is the cursor in the way, does
 * the frame show what the beat claimed) is left to a reviewer with eyes.
 *
 * A pure function over a recording, so every clause can be tested on a
 * timeline written by hand rather than by driving a browser.
 */

/** Nine to eleven seconds: what the clips this was built for are written to. */
export const DEFAULT_BOUNDS = { minSeconds: 9, maxSeconds: 11 };

export type Beat = {
  /** Matches a `settle({ label })` in the clip, exactly. */
  label: string;
  /** What should be visible by then. For the reviewer with eyes; unused here. */
  expect?: string;
};

export type ReviewBounds = { minSeconds?: number; maxSeconds?: number };

export type ReviewItem = {
  check:
    "duration" | "settles" | "beats" | "progress" | "rendered" | "onscreen";
  pass: boolean;
  /**
   * A finding worth printing that is not worth failing over: `pass` is false,
   * and the review's own `pass` is not affected.
   */
  warning?: boolean;
  detail: string;
};

export type ReviewResult = { pass: boolean; items: ReviewItem[] };

export type ReviewInput = {
  timeline: Timeline;
  /** From the recording's `settles.json`. Empty for a recording made without one. */
  settles?: SettleReport[];
  /** The clip's beat sheet. Empty when none was given. */
  beats?: Beat[];
  bounds?: ReviewBounds;
};

const seconds = (value: number) => `${value.toFixed(1)}s`;

function checkDuration(timeline: Timeline, bounds?: ReviewBounds): ReviewItem {
  const min = bounds?.minSeconds ?? DEFAULT_BOUNDS.minSeconds;
  const max = bounds?.maxSeconds ?? DEFAULT_BOUNDS.maxSeconds;
  const length = timeline.durationFrames / timeline.fps;
  const within = length >= min && length <= max;
  return {
    check: "duration",
    pass: within,
    detail: within
      ? `${seconds(length)}, within ${min}–${max}s`
      : `${seconds(length)} is outside ${min}–${max}s`,
  };
}

function checkSettles(settles: SettleReport[]): ReviewItem {
  if (settles.length === 0) {
    // Not a pass to be proud of, and said plainly: a recording made before
    // `settles.json` existed has nothing here to be right or wrong about.
    return {
      check: "settles",
      pass: true,
      detail: "no settles recorded; nothing to check",
    };
  }
  const late = settles.filter((s) => s.timedOut);
  return {
    check: "settles",
    pass: late.length === 0,
    detail:
      late.length === 0
        ? `${settles.length} settled, none timed out`
        : late
            .map((s) => `"${s.label}" timed out waiting on ${s.lastBlocker}`)
            .join("; "),
  };
}

function checkBeats(timeline: Timeline, beats: Beat[]): ReviewItem {
  const labels = new Set(timeline.marks.map((m) => m.label));
  if (beats.length === 0) {
    return { check: "beats", pass: true, detail: "no beat sheet given" };
  }
  const missing = beats.filter((beat) => !labels.has(beat.label));
  return {
    check: "beats",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? `${beats.length} beats, each with a mark`
        : `no settle labelled ${missing.map((b) => `"${b.label}"`).join(", ")}` +
          ` (the clip has ${[...labels].map((l) => `"${l}"`).join(", ") || "none"})`,
  };
}

/**
 * Did anything happen between one beat and the next?
 *
 * A beat that produced no new state is the classic authoring failure: the
 * script clicked something, waited for it, and the page it waited for looked
 * exactly like the page before. The clip runs, the review reads fine, and the
 * video shows a cursor moving over a screen that never answers.
 */
function checkProgress(timeline: Timeline): ReviewItem {
  const marks = timeline.marks;
  if (marks.length < 2) {
    return {
      check: "progress",
      pass: true,
      detail: `${marks.length} beat(s): nothing to compare`,
    };
  }

  const still: string[] = [];
  for (let i = 1; i < marks.length; i += 1) {
    const from = marks[i - 1];
    const to = marks[i];
    const span = timeline.frames.slice(from.frame, to.frame + 1);
    if (new Set(span).size <= 1) {
      still.push(
        `nothing changed between "${from.label}" (frame ${from.frame}) and ` +
          `"${to.label}" (frame ${to.frame})`,
      );
    }
  }

  return {
    check: "progress",
    pass: still.length === 0,
    detail:
      still.length === 0
        ? `the screen changed across all ${marks.length - 1} beat gaps`
        : still.join("; "),
  };
}

/**
 * Anything written past the last frame, which nothing will ever show.
 *
 * A camera key, a highlight and a caption all cost no time — they are track
 * writes at the current instant — so a clip that ends on one ends on an
 * instruction with no frames left to obey it. A pilot's clip closed with a
 * bare `camera.reset()` and the reset was never seen. A warning rather than a
 * failure: the clip is fine, one line of it is wasted, and the author is the
 * one who knows whether it mattered.
 */
function checkRendered(timeline: Timeline): ReviewItem {
  const lastFrame = timeline.durationFrames - 1;
  const late = (t: number) => frameAt(t, timeline.fps) > lastFrame;
  const unseen: string[] = [];

  // Once for the camera, at its last key. A camera that follows the cursor
  // or blends between moves has a key a frame, and one still under way at
  // the end left dozens past it: one line saying where the camera would have
  // stopped says everything they do.
  const lastKey = timeline.camera[timeline.camera.length - 1];
  if (lastKey && late(lastKey.t)) {
    unseen.push(`a camera key at ${seconds(lastKey.t)}`);
  }
  for (const highlight of timeline.highlights) {
    if (late(highlight.t0)) {
      unseen.push(`a highlight at ${seconds(highlight.t0)}`);
    }
  }
  for (const caption of timeline.captions) {
    if (late(caption.t0)) {
      unseen.push(`the caption "${caption.text}" at ${seconds(caption.t0)}`);
    }
  }

  if (unseen.length === 0) {
    return {
      check: "rendered",
      pass: true,
      detail: "every camera, highlight and caption has frames after it",
    };
  }
  return {
    check: "rendered",
    pass: false,
    warning: true,
    detail:
      `${unseen.join(", ")}: the clip ends at frame ${lastFrame} ` +
      `(${seconds(timeline.durationFrames / timeline.fps)}), so nothing renders them. ` +
      "A track write costs no time; give it a `hold` to be seen in.",
  };
}

/**
 * Is what the clip points at actually on screen?
 *
 * A highlight is drawn at the rectangle the driver measured, and a locator
 * below the fold measures perfectly well: `versioncam measure` reported the
 * example app's status line at y 928 in an 800-pixel viewport without comment,
 * and the clip that rings it has been drawing that ring off the bottom of the
 * frame since it was written. Nothing said so — not `record`, which succeeded,
 * not `review`, which had no clause for it, and not the video, which simply
 * lacks the ring it was supposed to end on.
 *
 * A click is the other thing a clip points at. The ripple is drawn where the
 * cursor was, and a click the camera is framing something else for is a
 * ripple drawn off the edge of the frame: the button changes, and nobody saw
 * it pressed. A camera that follows the cursor promises this never happens,
 * and this is where that promise is checked, for every other camera too.
 *
 * A warning rather than a failure: the camera can legitimately be somewhere
 * else entirely by the time a highlight runs, and only the renderer knows for
 * certain. But a highlight or a click wholly outside the frame is almost
 * always a mistake, and it is invisible in every other way.
 */
function checkOnScreen(timeline: Timeline): ReviewItem {
  const { width, height } = timeline.viewport;
  const full: Rect = { x: 0, y: 0, w: width, h: height };
  const cameraAt = (t: number): Rect =>
    timeline.camera.length > 0 ? evalCamera(timeline.camera, t) : full;

  // Against the camera, not the viewport.
  //
  // The first version of this clause compared a highlight to the whole page,
  // which is a true statement that does not add up to the thing anyone cares
  // about. An authoring agent hit the difference: its closing ring sat at
  // y 16–167, comfortably inside a 900-pixel viewport and comfortably *above*
  // a camera cropped to y 99 and down. The clause passed and the top of the
  // card — the chip naming the filter, the whole point of the shot — was not
  // in the frame.
  //
  // Sampled at both ends of the highlight because the camera can be moving
  // through it: a ring that starts cropped and ends visible is still a ring
  // someone can read.
  const visible = (h: (typeof timeline.highlights)[number]): boolean =>
    [cameraAt(h.t0), cameraAt(h.t1)].some(
      (r) =>
        h.rect.x + h.rect.w > r.x &&
        h.rect.y + h.rect.h > r.y &&
        h.rect.x < r.x + r.w &&
        h.rect.y < r.y + r.h,
    );
  const offscreen = timeline.highlights.filter((h) => !visible(h));

  // A click, at the moment the button goes down.
  const presses = timeline.pointer.filter((p) => p.kind === "down");
  const unseen = presses.filter((p) => {
    const r = cameraAt(p.t);
    const [x, y] = p.at;
    return x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h;
  });

  if (offscreen.length === 0 && unseen.length === 0) {
    return {
      check: "onscreen",
      pass: true,
      detail:
        `${timeline.highlights.length} highlight(s) and ${presses.length} ` +
        "click(s), all inside what the camera shows",
    };
  }
  const found: string[] = [];
  if (offscreen.length > 0) {
    const where = offscreen
      .map(
        (h) => `y ${Math.round(h.rect.y)}–${Math.round(h.rect.y + h.rect.h)}`,
      )
      .join(", ");
    found.push(
      `${offscreen.length} highlight(s) outside what the camera is showing ` +
        `(${where}), so no frame can show them`,
    );
  }
  if (unseen.length > 0) {
    const where = unseen
      .map(
        (p) =>
          `at ${seconds(p.t)} on (${Math.round(p.at[0])}, ${Math.round(p.at[1])})`,
      )
      .join(", ");
    found.push(
      `${unseen.length} click(s) outside what the camera is showing (${where}), ` +
        "so no frame shows the press",
    );
  }
  return {
    check: "onscreen",
    pass: false,
    warning: true,
    detail: found.join("; "),
  };
}

export function reviewRecording(input: ReviewInput): ReviewResult {
  const items: ReviewItem[] = [
    checkDuration(input.timeline, input.bounds),
    checkSettles(input.settles ?? []),
    checkBeats(input.timeline, input.beats ?? []),
    checkProgress(input.timeline),
    checkRendered(input.timeline),
    checkOnScreen(input.timeline),
  ];
  return {
    pass: items.every((item) => item.pass || item.warning === true),
    items,
  };
}

/** The result as a person reads it, one line a clause. */
export function formatReview(id: string, result: ReviewResult): string {
  const lines = [`${id}: ${result.pass ? "PASS" : "FAIL"}`];
  for (const item of result.items) {
    const mark = item.pass ? "✓" : item.warning ? "!" : "✗";
    lines.push(`  ${mark} ${item.check.padEnd(9)} ${item.detail}`);
  }
  return lines.join("\n");
}
