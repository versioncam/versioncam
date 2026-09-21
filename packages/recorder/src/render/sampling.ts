import type { Mark } from "../core/timeline.js";

/**
 * Which frames a contact sheet shows.
 *
 * Eight tiles, because that is what fits legibly on a screen at 960px wide and
 * what a reviewer will actually look at one by one.
 */
export const SHEET_TILES = 8;

/** Evenly spaced, ends included: the shape of the clip, knowing nothing about it. */
export function uniformFrames(
  durationFrames: number,
  count = SHEET_TILES,
): number[] {
  const tiles = Math.max(2, Math.min(count, durationFrames));
  return Array.from({ length: tiles }, (_, i) =>
    Math.round((i / (tiles - 1)) * (durationFrames - 1)),
  );
}

/**
 * Frame 0, every beat, and the last frame.
 *
 * An evenly spaced sample is blind to what a clip is *about*: a pilot's sheet
 * missed the one beat it had been written around, because nothing in eight
 * uniform samples knew where the beats were. The marks do.
 *
 * With more beats than tiles the ends are kept and the middle is thinned
 * evenly — a reviewer who cannot see every beat is better served by the shape
 * of the whole clip than by its first eight moments.
 */
export function markedFrames(
  durationFrames: number,
  marks: Mark[],
  count = SHEET_TILES,
): number[] {
  const inRange = (frame: number) =>
    Number.isInteger(frame) && frame >= 0 && frame < durationFrames;
  const wanted = [0, ...marks.map((m) => m.frame), durationFrames - 1].filter(
    inRange,
  );
  const unique = [...new Set(wanted)].sort((a, b) => a - b);
  if (unique.length <= count) return unique;

  const kept = [unique[0]];
  for (let i = 1; i <= count - 2; i += 1) {
    kept.push(unique[Math.round((i * (unique.length - 1)) / (count - 1))]);
  }
  kept.push(unique[unique.length - 1]);
  return [...new Set(kept)];
}
