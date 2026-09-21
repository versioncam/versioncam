/**
 * Minimum-jerk: the standard model of a human reaching movement.
 *
 *   x(u) = 10u³ − 15u⁴ + 6u⁵
 *
 * Its first *and* second derivatives vanish at both ends, so motion starts
 * and stops without a visible corner. This is the difference between a cursor
 * that looks like a person moved it and one that looks like a tween — and the
 * reason the recorder does not use CSS-style cubic-bezier easings, whose
 * acceleration is discontinuous at the endpoints.
 */
export function minjerk(u: number): number {
  const c = clamp01(u);
  return c * c * c * (10 + c * (-15 + 6 * c));
}

export function clamp01(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u;
}

export function clamp(value: number, min: number, max: number): number {
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}
