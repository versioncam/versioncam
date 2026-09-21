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
  crossfadeFrames = 0,
): number[] {
  const inRange = (frame: number) =>
    Number.isInteger(frame) && frame >= 0 && frame < durationFrames;
  // Past the crossfade, not at the mark itself.
  //
  // A mark sits at the first frame whose state is the settled one, which is
  // also the first frame of the renderer's crossfade — where the blend has
  // barely started and the tile still shows what was on screen *before* the
  // wait. Sampling there gave a reviewer the old page with the new one
  // ghosting through it: the beat looked like it had not happened.
  //
  // The mark stays where it is, because `review` wants the state boundary.
  // Only the picture needs to wait for the dissolve to finish.
  const settled = (frame: number) =>
    Math.min(frame + crossfadeFrames, durationFrames - 1);
  const wanted = [
    0,
    ...marks.map((m) => (m.frame === 0 ? 0 : settled(m.frame))),
    durationFrames - 1,
  ].filter(inRange);
  const unique = [...new Set(wanted)].sort((a, b) => a - b);

  // Fill the rest of the grid with an even spread.
  //
  // A clip with one beat gave a sheet of three tiles, and everything between
  // the beat and the end — a ring highlight, a camera move, whatever the clip
  // spent six of its ten seconds on — appeared in none of them. The beats are
  // what a sheet must not miss, not all it may show, so the spare tiles go to
  // the shape of the clip around them.
  if (unique.length < count) {
    const filled = new Set(unique);
    for (const frame of uniformFrames(durationFrames, count)) {
      if (filled.size >= count) break;
      filled.add(frame);
    }
    return [...filled].sort((a, b) => a - b);
  }
  if (unique.length === count) return unique;

  const kept = [unique[0]];
  for (let i = 1; i <= count - 2; i += 1) {
    kept.push(unique[Math.round((i * (unique.length - 1)) / (count - 1))]);
  }
  kept.push(unique[unique.length - 1]);
  return [...new Set(kept)];
}
