import { jitter } from "./rng";
import type { Rect, Vec2 } from "./timeline";

/**
 * A lasso stroke. Authored as a handful of points and smoothed into a closed
 * loop, because a polygon drawn by hand has no straight edges and no corners
 * — a four-point polygon played back verbatim looks like a selection
 * rectangle, not a lasso.
 */

/**
 * Uniform closed Catmull-Rom through `points`. The curve passes through every
 * control point, which is what makes authoring by fractions predictable.
 */
export function catmullRomClosed(
  points: Vec2[],
  samplesPerSegment: number,
): Vec2[] {
  if (points.length < 3) return [...points];
  const out: Vec2[] = [];
  const n = points.length;

  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    for (let s = 0; s < samplesPerSegment; s += 1) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }

  // Close the ring explicitly so callers can draw it without special-casing.
  out.push(out[0]);
  return out;
}

export type LoopPlanner = (box: Rect, rng: () => number) => Vec2[];

export type LoopOptions = {
  samplesPerSegment?: number;
  /** Radial wobble as a fraction of the box size. */
  jitter?: number;
};

/**
 * Author a lasso as fractions of the target's box, so the same stroke lands
 * on the same part of the map after a layout change.
 */
export function loop(
  fractions: readonly (readonly [number, number])[],
  options: LoopOptions = {},
): LoopPlanner {
  const samplesPerSegment = options.samplesPerSegment ?? 16;
  const wobble = options.jitter ?? 0.01;

  return (box, rng) => {
    const points: Vec2[] = fractions.map(([fx, fy]) => [
      box.x + fx * box.w + jitter(rng, wobble * box.w),
      box.y + fy * box.h + jitter(rng, wobble * box.h),
    ]);
    return catmullRomClosed(points, samplesPerSegment);
  };
}

/**
 * Resample a path so consecutive points are equally spaced, then walk it with
 * an easing. A raw Catmull-Rom is parameterised by segment, not by distance,
 * so playing it back directly speeds up and slows down at every control
 * point — visible as a stutter in the stroke.
 */
export function resampleByArcLength(path: Vec2[], count: number): Vec2[] {
  if (path.length === 0) return [];
  if (count <= 1) return [path[0]];

  const cumulative: number[] = [0];
  for (let i = 1; i < path.length; i += 1) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    cumulative.push(cumulative[i - 1] + Math.hypot(dx, dy));
  }
  const total = cumulative[cumulative.length - 1];
  if (total === 0) return new Array<Vec2>(count).fill(path[0]);

  const out: Vec2[] = [];
  let cursor = 1;
  for (let i = 0; i < count; i += 1) {
    const target = (i / (count - 1)) * total;
    while (cursor < cumulative.length - 1 && cumulative[cursor] < target) {
      cursor += 1;
    }
    const spanStart = cumulative[cursor - 1];
    const spanEnd = cumulative[cursor];
    const span = spanEnd - spanStart;
    const u = span <= 0 ? 0 : (target - spanStart) / span;
    const a = path[cursor - 1];
    const b = path[cursor];
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}
