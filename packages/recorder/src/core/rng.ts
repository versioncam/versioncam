/**
 * A seeded PRNG, because "looks human" and "identical every run" have to hold
 * at the same time. Every jittered decision in the recorder — arc direction,
 * dwell length, where inside a button the cursor lands, typing cadence —
 * draws from one of these, seeded per clip.
 *
 * mulberry32: small, fast, and good enough for motion jitter.
 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value in [min, max) from `rng`. */
export function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** A symmetric jitter in [-magnitude, +magnitude). */
export function jitter(rng: () => number, magnitude: number): number {
  return (rng() * 2 - 1) * magnitude;
}
