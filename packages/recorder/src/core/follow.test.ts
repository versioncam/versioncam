import { describe, expect, it } from "vitest";
import { evalCamera } from "./camera.js";
import { cameraTrack } from "./camera-track.js";
import type { CameraWrite } from "./camera-track.js";
import { evalCursor, planMove } from "./cursor.js";
import {
  followCentres,
  resolveFollow,
  springStep,
  zeroPhaseSpring,
} from "./follow.js";
import type { FollowSpec } from "./follow.js";
import { MOTION } from "./motion-defaults.js";
import { seeded } from "./rng.js";
import { emptyTimeline, timeAt, validateTimeline } from "./timeline.js";
import type { CameraKey, CursorTrack, Rect, Vec2 } from "./timeline.js";

/**
 * The follow camera and the camera track it is compiled into, on cursor
 * paths made the way the session makes them: min-jerk moves of Fitts-law
 * durations with a slight arc, and holds between them.
 */

const VIEWPORT = { width: 1440, height: 900 };
const FPS = 60;
const SPEC: FollowSpec = {
  scale: MOTION.followZoom,
  deadZone: MOTION.followDeadZone,
  smoothingMs: MOTION.followSmoothingMs,
};
const START: Vec2 = [VIEWPORT.width * 0.94, VIEWPORT.height * 0.9];

/** A cursor that rests, then visits each point in turn and dwells there. */
function cursorTrack(
  points: Vec2[],
  options: { restS?: number; dwellMs?: number; seed?: number } = {},
): { track: CursorTrack; end: number } {
  const rng = seeded(options.seed ?? 5);
  const track: CursorTrack = [];
  let t = options.restS ?? 0.5;
  let at = points[0];
  track.push({ kind: "hold", t0: 0, t1: t, at });
  for (const point of points.slice(1)) {
    const move = planMove(at, point, t, rng, { targetSize: 36 });
    track.push(move);
    t = move.t1;
    const dwell = (options.dwellMs ?? 450) / 1000;
    track.push({ kind: "hold", t0: t, t1: t + dwell, at: point });
    t += dwell;
    at = point;
  }
  return { track, end: t };
}

/** Across a 1440×900 page and back: the moves a follow is for. */
const ACROSS: Vec2[] = [
  [700, 450],
  [1250, 760],
  [260, 700],
  [1300, 180],
  [200, 150],
  [700, 450],
];

const context = (track: CursorTrack, end: number, fps = FPS) => ({
  viewport: VIEWPORT,
  fps,
  durationFrames: Math.round(end * fps) + 1,
  cursor: track,
  cursorStart: START,
});

/** The camera at every frame, as the renderer asks for it. */
function framesOf(
  keys: CameraKey[],
  durationFrames: number,
  fps = FPS,
): Rect[] {
  return Array.from({ length: durationFrames }, (_, f) =>
    evalCamera(keys, timeAt(f, fps)),
  );
}

const centreOf = (r: Rect): Vec2 => [r.x + r.w / 2, r.y + r.h / 2];

/** Per-frame velocity of the frame's centre and width, in pixels a second. */
function velocities(frames: Rect[], fps = FPS): Vec2[] {
  return frames.slice(1).map((r, i) => {
    const [ax, ay] = centreOf(frames[i]);
    const [bx, by] = centreOf(r);
    return [(bx - ax) * fps, (by - ay) * fps];
  });
}

/**
 * The largest change of velocity from one frame to the next, in pixels a
 * second, of the frame's centre and of its width.
 */
function largestKick(frames: Rect[], fps: number): number {
  const v = velocities(frames, fps);
  let largest = 0;
  for (let i = 1; i < v.length; i += 1) {
    largest = Math.max(
      largest,
      Math.hypot(v[i][0] - v[i - 1][0], v[i][1] - v[i - 1][1]),
    );
  }
  for (let i = 2; i < frames.length; i += 1) {
    const a = (frames[i - 1].w - frames[i - 2].w) * fps;
    const b = (frames[i].w - frames[i - 1].w) * fps;
    largest = Math.max(largest, Math.abs(b - a));
  }
  return largest;
}

/**
 * Whether the camera's velocity is continuous, asked without a threshold on
 * how hard the camera may accelerate.
 *
 * Where velocity is continuous, the change from one frame to the next is
 * acceleration times the frame's length, so recording the same writes at 240
 * frames a second instead of 60 cuts the largest change to about a quarter.
 * A jump in position, or a corner in velocity, is the same size however
 * finely time is cut, and the ratio stays near 1. A follow's natural
 * acceleration and a corner at its entry can be the same size at 60 frames a
 * second, which is why a plain threshold could not tell them apart.
 */
function kickRatio(writes: CameraWrite[], track: CursorTrack, end: number) {
  const at = (fps: number) => {
    const c = context(track, end, fps);
    return largestKick(
      framesOf(cameraTrack(writes, c), c.durationFrames, fps),
      fps,
    );
  };
  return at(240) / at(60);
}

const inside = (p: Vec2, r: Rect, margin = 0) =>
  p[0] >= r.x + margin &&
  p[0] <= r.x + r.w - margin &&
  p[1] >= r.y + margin &&
  p[1] <= r.y + r.h - margin;

describe("the spring", () => {
  it("steps exactly: two half steps are one whole one", () => {
    // Exact for a target held still, so how finely time is cut does not
    // change where the spring gets to.
    const omega = 13;
    const [y1, v1] = springStep(0, 0, 100, omega, 0.05);
    const [y2, v2] = springStep(y1, v1, 100, omega, 0.05);
    const [y, v] = springStep(0, 0, 100, omega, 0.1);
    expect(y2).toBeCloseTo(y, 9);
    expect(v2).toBeCloseTo(v, 9);
  });

  it("answers a jump without lag, without overshoot, and symmetrically", () => {
    const input = Array.from({ length: 241 }, (_, i) => (i < 120 ? 0 : 100));
    const out = zeroPhaseSpring(input, 1 / 0.075, 1 / FPS);
    // Never past either side of the jump, and never turning back.
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(100);
      if (i > 0) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
    }
    // Centred on the jump: halfway there, give or take the half-step either
    // side of it, as far before as it is after.
    expect(out[119] + out[120]).toBeCloseTo(100, 0);
    expect(out[120 - 20]).toBeCloseTo(100 - out[119 + 20], 6);
  });
});

describe("followCentres", () => {
  const { track, end } = cursorTrack(ACROSS);
  const path = (spec = SPEC, until = Number.POSITIVE_INFINITY, fps = FPS) =>
    followCentres({
      cursor: track,
      cursorStart: START,
      viewport: VIEWPORT,
      fps,
      spec,
      firstFrame: 0,
      lastFrame: Math.round(end * fps),
      until,
    });

  it("keeps the frame inside the page, whatever the cursor does", () => {
    // The cursor visits every corner of the page; the frame's centre can
    // never be nearer an edge than half the frame.
    const w = VIEWPORT.width / SPEC.scale;
    const h = VIEWPORT.height / SPEC.scale;
    for (const [x, y] of path()) {
      expect(x).toBeGreaterThanOrEqual(w / 2 - 1e-9);
      expect(x).toBeLessThanOrEqual(VIEWPORT.width - w / 2 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(h / 2 - 1e-9);
      expect(y).toBeLessThanOrEqual(VIEWPORT.height - h / 2 + 1e-9);
    }
  });

  it("keeps the cursor in frame across the page, with room to spare", () => {
    const w = VIEWPORT.width / SPEC.scale;
    const h = VIEWPORT.height / SPEC.scale;
    path().forEach(([x, y], frame) => {
      const [px, py] = evalCursor(track, frame / FPS);
      // Within 90% of the half-frame of the centre: a cursor crossing the
      // page at full speed is never at the frame's edge.
      expect(Math.abs(px - x)).toBeLessThan(0.9 * (w / 2));
      expect(Math.abs(py - y)).toBeLessThan(0.9 * (h / 2));
    });
  });

  it("does not answer a cursor moving inside the dead zone", () => {
    // Settle on a point, then wander 60 pixels each way: inside the 160 by
    // 100 the dead zone allows at this scale, so the camera does not move.
    const { track: small, end: smallEnd } = cursorTrack(
      [
        [700, 450],
        [760, 490],
        [660, 420],
        [740, 470],
        [700, 450],
      ],
      { restS: 1.5 },
    );
    const centres = followCentres({
      cursor: small,
      cursorStart: START,
      viewport: VIEWPORT,
      fps: FPS,
      spec: SPEC,
      firstFrame: 0,
      lastFrame: Math.round(smallEnd * FPS),
      until: Number.POSITIVE_INFINITY,
    });
    for (const [x, y] of centres) {
      expect(x).toBeCloseTo(700, 6);
      expect(y).toBeCloseTo(450, 6);
    }
  });

  it("answers the same wander once the dead zone is gone", () => {
    const { track: small, end: smallEnd } = cursorTrack([
      [700, 450],
      [760, 490],
      [660, 420],
    ]);
    const centres = followCentres({
      cursor: small,
      cursorStart: START,
      viewport: VIEWPORT,
      fps: FPS,
      spec: { ...SPEC, deadZone: 0 },
      firstFrame: 0,
      lastFrame: Math.round(smallEnd * FPS),
      until: Number.POSITIVE_INFINITY,
    });
    const xs = centres.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50);
  });

  it("never overshoots: one move, one direction, no further than the cursor went", () => {
    const { track: one, end: oneEnd } = cursorTrack([
      [300, 450],
      [1150, 450],
    ]);
    const xs = followCentres({
      cursor: one,
      cursorStart: START,
      viewport: VIEWPORT,
      fps: FPS,
      spec: { ...SPEC, deadZone: 0 },
      firstFrame: 0,
      lastFrame: Math.round(oneEnd * FPS) + 60,
      until: Number.POSITIVE_INFINITY,
    }).map(([x]) => x);
    const lo = VIEWPORT.width / SPEC.scale / 2;
    const hi = VIEWPORT.width - lo;
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
      expect(xs[i]).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(xs[i]).toBeLessThanOrEqual(Math.min(1150, hi) + 1e-9);
    }
  });

  it("is the same path every time, to the bit", () => {
    expect(path()).toEqual(path());
  });

  it("is nearly the same path at a draft's frame rate", () => {
    // A draft samples the cursor four times less often; the spring is exact
    // between samples, so the paths differ only by where the cursor was read.
    const full = path();
    const draft = path(SPEC, Number.POSITIVE_INFINITY, 15);
    let worst = 0;
    draft.forEach(([x, y], frame) => {
      if (frame * 4 >= full.length) return;
      const [fx, fy] = full[frame * 4];
      worst = Math.max(worst, Math.abs(x - fx), Math.abs(y - fy));
    });
    expect(worst).toBeLessThan(12);
  });

  it("comes to rest where the window was, once it stops reading the cursor", () => {
    const until = 2.2;
    const centres = path(SPEC, until);
    const settled = centres[centres.length - 1];
    // Long after `until`, still; and the cursor at `until` is inside the dead
    // zone around where it stopped.
    const tail = centres.slice(-30);
    for (const [x, y] of tail) {
      expect(x).toBeCloseTo(settled[0], 6);
      expect(y).toBeCloseTo(settled[1], 6);
    }
    // At rest where the window was: the cursor inside the dead zone around
    // it, or the frame against the page's edge on the cursor's side.
    const [px, py] = evalCursor(track, until);
    const w = VIEWPORT.width / SPEC.scale;
    const h = VIEWPORT.height / SPEC.scale;
    const held = (
      p: number,
      c: number,
      slack: number,
      lo: number,
      hi: number,
    ) =>
      Math.abs(p - c) <= slack + 1e-6 ||
      (p < c && c <= lo + 1e-6) ||
      (p > c && c >= hi - 1e-6);
    expect(
      held(
        px,
        settled[0],
        (SPEC.deadZone * w) / 2,
        w / 2,
        VIEWPORT.width - w / 2,
      ),
    ).toBe(true);
    expect(
      held(
        py,
        settled[1],
        (SPEC.deadZone * h) / 2,
        h / 2,
        VIEWPORT.height - h / 2,
      ),
    ).toBe(true);
  });
});

describe("cameraTrack", () => {
  const { track, end } = cursorTrack(ACROSS);
  const ctx = context(track, end);
  const full: Rect = { x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height };
  const left: Rect = { x: 0, y: 0, w: 960, h: 600 };
  const right: Rect = { x: 480, y: 300, w: 960, h: 600 };

  /**
   * What the session wrote before the camera could follow, verbatim: hold
   * the current framing until the write, then glide to the new one.
   */
  function oldKeys(writes: { t: number; rect: Rect; durationMs: number }[]) {
    const keys: CameraKey[] = [{ t: 0, rect: full, ease: "hold" }];
    for (const w of writes) {
      const last = keys[keys.length - 1];
      if (last.t < w.t) keys.push({ t: w.t, rect: last.rect, ease: "hold" });
      keys.push({
        t: w.t + w.durationMs / 1000,
        rect: w.rect,
        ease: "minjerk",
      });
    }
    return keys;
  }

  const frame = (t: number, rect: Rect, durationMs = 1100): CameraWrite => ({
    t,
    kind: "frame",
    rect,
    durationMs,
  });
  const follow = (
    t: number,
    spec: Partial<FollowSpec> = {},
    durationMs = 1100,
  ): CameraWrite => ({
    t,
    kind: "follow",
    spec: { ...SPEC, ...spec },
    durationMs,
  });

  it("writes the opening key alone when nothing moves the camera", () => {
    expect(cameraTrack([], ctx)).toEqual([{ t: 0, rect: full, ease: "hold" }]);
  });

  it("writes exactly the old keys for moves that wait for each other", () => {
    // Every recording made so far is one of these, and the golden fixture
    // and every clip that only zooms must not change by a byte.
    const cases: { t: number; rect: Rect; durationMs: number }[][] = [
      [{ t: 1, rect: left, durationMs: 1100 }],
      [
        { t: 0.5, rect: left, durationMs: 1100 },
        { t: 3, rect: right, durationMs: 800 },
        { t: 5, rect: full, durationMs: 1100 },
      ],
      // A move that starts the instant the last one arrives: no hold between.
      [
        { t: 1, rect: left, durationMs: 1000 },
        { t: 2, rect: right, durationMs: 1000 },
      ],
      // A cut, and a glide from it at the same instant.
      [
        { t: 1, rect: left, durationMs: 0 },
        { t: 1, rect: right, durationMs: 1100 },
      ],
      // At the very start, before any frame.
      [{ t: 0, rect: right, durationMs: 1100 }],
    ];
    for (const writes of cases) {
      const keys = cameraTrack(
        writes.map((w) => frame(w.t, w.rect, w.durationMs)),
        ctx,
      );
      expect(JSON.stringify(keys)).toBe(JSON.stringify(oldKeys(writes)));
    }
  });

  it("starts a move written during another at once, and gives it its whole duration", () => {
    // The old keys waited for the first glide to arrive at 1.6s and then ran
    // the second in the half second left before 2.1s: a stop, then a snap.
    const far: Rect = { x: 480, y: 300, w: 720, h: 450 };
    const keys = cameraTrack(
      [frame(0.5, left, 1100), frame(1.0, far, 1100)],
      ctx,
    );
    const frames = framesOf(keys, Math.round(2.5 * FPS));
    // Never still between the first write and the second's arrival.
    const v = velocities(frames);
    for (
      let f = Math.round(0.5 * FPS) + 2;
      f < Math.round(2.1 * FPS) - 2;
      f += 1
    ) {
      expect(Math.hypot(v[f][0], v[f][1])).toBeGreaterThan(1);
    }
    // Arrives when the second write said, not before.
    expect(frames[Math.round(2.0 * FPS)]).not.toEqual(far);
    expect(frames[Math.round(2.1 * FPS)]).toEqual(far);
    expect(
      kickRatio([frame(0.5, left, 1100), frame(1.0, far, 1100)], track, end),
    ).toBeLessThan(0.35);
  });

  it("lets the last of two writes at the same instant win", () => {
    // Exactly as if the first had never been written: no curve towards it.
    expect(cameraTrack([frame(1, left), frame(1, right)], ctx)).toEqual(
      cameraTrack([frame(1, right)], ctx),
    );
    expect(cameraTrack([follow(1), frame(1, right)], ctx)).toEqual(
      cameraTrack([frame(1, right)], ctx),
    );
  });

  it("enters a follow from the whole page without a jump, then holds its scale", () => {
    const keys = cameraTrack([follow(1)], ctx);
    const frames = framesOf(keys, ctx.durationFrames);
    // Still the whole page when the follow is written, then eased away.
    expect(frames[Math.round(1 * FPS)]).toEqual(full);
    expect(kickRatio([follow(1)], track, end)).toBeLessThan(0.35);
    // Once the blend is over, one scale, exactly.
    const w = VIEWPORT.width / SPEC.scale;
    for (const r of frames.slice(Math.round(2.1 * FPS) + 1)) {
      expect(r.w).toBeCloseTo(w, 2);
      expect(r.h).toBeCloseTo(VIEWPORT.height / SPEC.scale, 2);
    }
  });

  it("enters a follow from the middle of a glide without a corner", () => {
    // The follow is written while a zoom is under way: the camera carries its
    // speed into the follow instead of stopping at the zoom's target first.
    const keys = cameraTrack([frame(0.3, right, 1100), follow(0.9)], ctx);
    const frames = framesOf(keys, ctx.durationFrames);
    const v = velocities(frames);
    const at = Math.round(0.9 * FPS);
    expect(Math.hypot(v[at][0], v[at][1])).toBeGreaterThan(50);
    expect(
      kickRatio([frame(0.3, right, 1100), follow(0.9)], track, end),
    ).toBeLessThan(0.35);
  });

  it("leaves a follow for a reset without a jump, and arrives on time", () => {
    const keys = cameraTrack([follow(0.5), frame(4, full, 1100)], ctx);
    const frames = framesOf(keys, ctx.durationFrames);
    expect(
      kickRatio([follow(0.5), frame(4, full, 1100)], track, end),
    ).toBeLessThan(0.35);
    expect(frames[Math.round(5.0 * FPS)]).not.toEqual(full);
    expect(frames[Math.round(5.1 * FPS)]).toEqual(full);
    expect(frames[frames.length - 1]).toEqual(full);
  });

  it("comes to rest after a release, and stays", () => {
    const writes: CameraWrite[] = [follow(0.5), { t: 4, kind: "release" }];
    const keys = cameraTrack(writes, ctx);
    const frames = framesOf(keys, ctx.durationFrames);
    expect(kickRatio(writes, track, end)).toBeLessThan(0.35);
    // Still from a second after the release to the end, though the cursor
    // goes on crossing the page.
    const still = frames.slice(Math.round(5 * FPS));
    for (const r of still) expect(r).toEqual(still[0]);
    // Which the keys say as two keys, not a key a frame.
    const after = keys.filter((k) => k.t > 5.5);
    expect(after.length).toBeLessThanOrEqual(2);
  });

  it("sees a cut as the jump it is, which is what makes the smooth ones mean something", () => {
    // Duration 0 asks for a cut. If the continuity measure could not see
    // this, it could not see anything.
    expect(kickRatio([follow(0.5, {}, 0)], track, end)).toBeGreaterThan(0.9);
    expect(
      kickRatio([follow(0.5), frame(4, full, 0)], track, end),
    ).toBeGreaterThan(0.9);
  });

  it("ignores a release with nothing to release", () => {
    const writes: CameraWrite[] = [frame(1, left), { t: 3, kind: "release" }];
    expect(cameraTrack(writes, ctx)).toEqual(
      cameraTrack([frame(1, left)], ctx),
    );
  });

  it("keeps every frame inside the page and the cursor in it, following across it", () => {
    const keys = cameraTrack([follow(0.5), frame(end - 1.2, full)], ctx);
    const frames = framesOf(keys, ctx.durationFrames);
    frames.forEach((r, f) => {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(VIEWPORT.width + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(VIEWPORT.height + 1e-6);
      expect(inside(evalCursor(track, timeAt(f, FPS)), r)).toBe(true);
    });
  });

  it("makes a timeline the renderer accepts, the same way every time", () => {
    const writes = [
      follow(0.5),
      frame(4, left),
      follow(5.5),
      frame(end - 1.2, full),
    ];
    const keys = cameraTrack(writes, ctx);
    expect(cameraTrack(writes, ctx)).toEqual(keys);
    const timeline = emptyTimeline({
      clipId: "follow",
      fps: FPS,
      viewport: { ...VIEWPORT, dpr: 2 },
      title: "Follow",
      appCommit: "unknown",
      baseUrl: "http://fixture.local",
      recordedAt: "1970-01-01T00:00:00.000Z",
    });
    timeline.camera = keys;
    expect(validateTimeline(timeline)).toEqual([]);
    expect(keys.every((k, i) => i === 0 || k.ease === "linear")).toBe(true);
  });

  it("leaves keys past the end only for a move the clip ends in the middle of", () => {
    const lastT = timeAt(ctx.durationFrames - 1, FPS);
    const arrived = cameraTrack([follow(0.5), frame(lastT - 2, full)], ctx);
    expect(arrived[arrived.length - 1].t).toBeLessThanOrEqual(lastT);
    const cut = cameraTrack([follow(0.5), frame(lastT - 0.3, full)], ctx);
    expect(cut[cut.length - 1].t).toBeGreaterThan(lastT);
  });
});

describe("resolveFollow", () => {
  it("fills in the config's defaults", () => {
    expect(resolveFollow({}, MOTION)).toEqual({
      spec: {
        scale: MOTION.followZoom,
        deadZone: MOTION.followDeadZone,
        smoothingMs: MOTION.followSmoothingMs,
      },
      durationMs: MOTION.zoomDurationMs,
    });
  });

  it("refuses a value the camera cannot use, and says which", () => {
    expect(() => resolveFollow({ scale: 0.8 }, MOTION)).toThrow(/scale is 0.8/);
    expect(() => resolveFollow({ deadZone: 1 }, MOTION)).toThrow(/deadZone/);
    expect(() => resolveFollow({ smoothing: 0 }, MOTION)).toThrow(/smoothing/);
    expect(() => resolveFollow({ duration: -1 }, MOTION)).toThrow(/duration/);
    expect(() => resolveFollow({ scale: Number.NaN }, MOTION)).toThrow(/scale/);
  });
});
