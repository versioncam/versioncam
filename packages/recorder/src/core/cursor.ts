import { clamp, minjerk } from "./easing";
import { jitter } from "./rng";
import type { CursorTrack, Rect, Vec2 } from "./timeline";
import type { CursorSegment } from "./timeline";

/** Straight-line distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Fitts's law, loosely: a move takes longer the further it goes and the
 * smaller the thing it is aiming at. Without this every move takes the same
 * time and the cursor reads as a machine — a nudge to an adjacent button
 * should not take as long as a sweep across the window.
 *
 * Returns milliseconds.
 */
export function moveDuration(dist: number, targetSize: number): number {
  const size = Math.max(targetSize, MIN_TARGET_SIZE);
  const raw = 250 + 120 * Math.log2(dist / size + 1);
  return clamp(raw, 300, 900);
}

const MIN_TARGET_SIZE = 24;
const ARC_MIN = 0.05;
const ARC_MAX = 0.1;

/**
 * Where inside a box to aim. Dead centre every time is another machine tell,
 * so land within the middle ~quarter but never exactly on the middle.
 */
export function targetPoint(box: Rect, rng: () => number): Vec2 {
  return [
    box.x + box.w / 2 + jitter(rng, 0.12 * box.w),
    box.y + box.h / 2 + jitter(rng, 0.12 * box.h),
  ];
}

export type PlanMoveOptions = {
  /** Smallest dimension of the target, for the Fitts term. */
  targetSize?: number;
  /** Override the computed duration, in milliseconds. */
  duration?: number;
};

/**
 * A single move, as a quadratic Bézier with a slight perpendicular bow.
 * People do not move a mouse in straight lines; a small arc is the cheapest
 * convincing correction, and its direction alternates by seed so repeated
 * moves along the same axis do not all curve the same way.
 */
export function planMove(
  from: Vec2,
  to: Vec2,
  t0: number,
  rng: () => number,
  options: PlanMoveOptions = {},
): CursorSegment {
  const dist = distance(from, to);
  const durationMs =
    options.duration ??
    moveDuration(dist, options.targetSize ?? MIN_TARGET_SIZE);

  const mid: Vec2 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  let ctrl: Vec2 = mid;
  if (dist > 0) {
    const arc = ARC_MIN + rng() * (ARC_MAX - ARC_MIN);
    const sign = rng() < 0.5 ? -1 : 1;
    // Unit normal to the travel direction.
    const nx = -(to[1] - from[1]) / dist;
    const ny = (to[0] - from[0]) / dist;
    const offset = dist * arc * sign;
    ctrl = [mid[0] + nx * offset, mid[1] + ny * offset];
  }

  return {
    kind: "move",
    t0,
    t1: t0 + durationMs / 1000,
    from,
    to,
    ctrl,
    ease: "minjerk",
  };
}

function bezier(from: Vec2, ctrl: Vec2, to: Vec2, u: number): Vec2 {
  const inv = 1 - u;
  const a = inv * inv;
  const b = 2 * inv * u;
  const c = u * u;
  return [
    a * from[0] + b * ctrl[0] + c * to[0],
    a * from[1] + b * ctrl[1] + c * to[1],
  ];
}

/**
 * Where the cursor is at time `t`. Before the track starts it sits at the
 * first known position; after it ends, at the last.
 */
export function evalCursor(track: CursorTrack, t: number): Vec2 {
  if (track.length === 0) return [0, 0];

  const first = track[0];
  if (t <= first.t0) return first.kind === "move" ? first.from : first.at;

  for (const step of track) {
    if (t > step.t1) continue;
    if (step.kind === "hold") return step.at;
    const span = step.t1 - step.t0;
    const u = span <= 0 ? 1 : (t - step.t0) / span;
    return bezier(step.from, step.ctrl, step.to, minjerk(u));
  }

  const last = track[track.length - 1];
  return last.kind === "move" ? last.to : last.at;
}

/** Where the cursor ends up once the whole track has played. */
export function cursorEnd(track: CursorTrack, fallback: Vec2): Vec2 {
  if (track.length === 0) return fallback;
  const last = track[track.length - 1];
  return last.kind === "move" ? last.to : last.at;
}
