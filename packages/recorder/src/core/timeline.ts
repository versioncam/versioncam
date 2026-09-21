/**
 * The contract between the driver (which captures) and the renderer (which
 * composites). A recording is a directory of state PNGs plus one of these.
 *
 * Coordinates are CSS pixels in viewport space — the same space
 * `locator.boundingBox()` reports — so a timeline is independent of the
 * device pixel ratio it was captured at. The renderer multiplies by
 * `viewport.dpr` when it needs to address pixels inside a state image.
 *
 * Times are seconds from the start of the clip. Durations elsewhere in the
 * recorder are milliseconds, because that is the unit a person authoring a
 * clip thinks in; conversions happen at the boundary.
 */

export type Vec2 = readonly [number, number];

export type Rect = { x: number; y: number; w: number; h: number };

export type CursorSegment = {
  kind: "move";
  t0: number;
  t1: number;
  from: Vec2;
  to: Vec2;
  /** Quadratic Bézier control point: the slight arc that reads as human. */
  ctrl: Vec2;
  ease: "minjerk";
};

export type CursorHold = {
  kind: "hold";
  t0: number;
  t1: number;
  at: Vec2;
};

export type CursorStep = CursorSegment | CursorHold;
export type CursorTrack = CursorStep[];

export type PointerAction = {
  t: number;
  kind: "down" | "up";
  at: Vec2;
  button: "left";
};

export type CameraKey = {
  t: number;
  rect: Rect;
  /** How to reach this key from the previous one. */
  ease: "minjerk" | "hold";
};

export type HighlightStyle = "ring" | "spotlight";

export type Highlight = {
  t0: number;
  t1: number;
  rect: Rect;
  style: HighlightStyle;
};

export type Caption = { t0: number; t1: number; text: string };

export type Timeline = {
  version: 1;
  clipId: string;
  fps: number;
  durationFrames: number;
  viewport: { width: number; height: number; dpr: number };
  /** State file names, relative to the recording's `states/` directory. */
  states: string[];
  /** Length `durationFrames`; `frames[f]` indexes into `states`. */
  frames: number[];
  /**
   * Frames where a settle happened, i.e. where the page may have changed a
   * lot at once. The renderer crossfades only here — everywhere else a state
   * change is a real one-frame change and should stay crisp.
   */
  cuts: number[];
  cursor: CursorTrack;
  pointer: PointerAction[];
  camera: CameraKey[];
  highlights: Highlight[];
  captions: Caption[];
  meta: {
    title: string;
    recordedAt: string;
    appCommit: string;
    baseUrl: string;
    /**
     * How many frames were screenshotted, as opposed to reusing the previous
     * frame's state. A property of the recording, not of the machine — the
     * same script against the same app skips the same frames — so it belongs
     * here, where wall-clock timings deliberately do not.
     */
    captured?: number;
    /**
     * Recorded in draft: fewer frames, captured at CSS scale. A draft is for
     * looking at while writing a clip, never for publishing.
     */
    draft?: boolean;
  };
};

export type TimelineInit = {
  clipId: string;
  fps: number;
  viewport: { width: number; height: number; dpr: number };
  title: string;
  appCommit: string;
  baseUrl: string;
  recordedAt: string;
};

export function emptyTimeline(init: TimelineInit): Timeline {
  return {
    version: 1,
    clipId: init.clipId,
    fps: init.fps,
    durationFrames: 0,
    viewport: init.viewport,
    states: [],
    frames: [],
    cuts: [],
    cursor: [],
    pointer: [],
    camera: [
      {
        t: 0,
        rect: { x: 0, y: 0, w: init.viewport.width, h: init.viewport.height },
        ease: "hold",
      },
    ],
    highlights: [],
    captions: [],
    meta: {
      title: init.title,
      recordedAt: init.recordedAt,
      appCommit: init.appCommit,
      baseUrl: init.baseUrl,
    },
  };
}

/** The frame a given time falls in. Frame f covers [f/fps, (f+1)/fps). */
export function frameAt(t: number, fps: number): number {
  return Math.round(t * fps);
}

/** The time a frame starts at. */
export function timeAt(frame: number, fps: number): number {
  return frame / fps;
}

/**
 * Structural checks that must hold for any timeline the renderer accepts.
 * Returns the problems found so a caller can report all of them at once.
 */
export function validateTimeline(timeline: Timeline): string[] {
  const problems: string[] = [];
  if (timeline.frames.length !== timeline.durationFrames) {
    problems.push(
      `frames has ${timeline.frames.length} entries but durationFrames is ${timeline.durationFrames}`,
    );
  }
  for (const [index, state] of timeline.frames.entries()) {
    if (state < 0 || state >= timeline.states.length) {
      problems.push(`frames[${index}] = ${state} is not a valid state index`);
      break;
    }
  }
  if (timeline.camera.length === 0) {
    problems.push("camera has no keys");
  } else if (timeline.camera[0].t !== 0) {
    problems.push("camera must open with a key at t=0");
  }
  const cameraOutOfOrder = timeline.camera.some(
    (key, index) => index > 0 && key.t < timeline.camera[index - 1].t,
  );
  if (cameraOutOfOrder) problems.push("camera keys are not sorted by time");
  const cursorOutOfOrder = timeline.cursor.some(
    (step, index) => index > 0 && step.t0 < timeline.cursor[index - 1].t0,
  );
  if (cursorOutOfOrder) problems.push("cursor steps are not sorted by time");
  return problems;
}
