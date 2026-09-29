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
 * The first frame at or after `frame` that is not inside a dissolve.
 *
 * The renderer dissolves between states for `crossfadeFrames` after every
 * cut, and a tile taken inside that window is two pages at once. A reviewer
 * shown one said so and declined to judge the beat from it, which is the
 * right answer to a question that should not have been asked.
 *
 * Two settles a few frames apart overlap their dissolves, and the first frame
 * after one can be inside the next, so the frame moves on until it is clear
 * of all of them. Never past the last frame, which has nothing after it.
 */
function pastCrossfade(
  frame: number,
  durationFrames: number,
  crossfadeFrames: number,
  cuts: readonly number[],
): number {
  let clear = frame;
  for (;;) {
    const cut = cuts.find((c) => clear > c && clear <= c + crossfadeFrames);
    if (cut === undefined) break;
    clear = cut + crossfadeFrames + 1;
  }
  return Math.min(clear, durationFrames - 1);
}

/**
 * Evenly spaced, ends included, and none of them inside a dissolve: the
 * frames a sheet shows when nobody chose them.
 *
 * An even spread knows nothing about the clip, so it lands wherever the
 * spacing puts it, and after a settle that can be the renderer's crossfade: a
 * plain sheet of the example app showed two tiles with one page ghosting
 * through the next, which `--at-marks` had stopped doing for its own tiles
 * long before. A tile inside a dissolve moves to the first frame after it.
 * The first frame is never inside one, the last stays the last, and two
 * tiles that land on the same frame are one.
 */
export function evenFrames(
  durationFrames: number,
  count = SHEET_TILES,
  crossfadeFrames = 0,
  cuts: readonly number[] = [],
): number[] {
  const tiles = uniformFrames(durationFrames, count).map((frame) =>
    pastCrossfade(frame, durationFrames, crossfadeFrames, cuts),
  );
  return [...new Set(tiles)].sort((a, b) => a - b);
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
  cuts: readonly number[] = [],
): number[] {
  const inRange = (frame: number) =>
    Number.isInteger(frame) && frame >= 0 && frame < durationFrames;
  // A mark is the worst case of a tile inside a dissolve: it sits on the
  // cut's first frame, where the blend has barely begun and the tile still
  // shows what was on screen *before* the wait. `beatFrame` moves its tile
  // past the dissolve that starts there; the marks themselves stay where
  // they are, because `review` wants the state boundary. The spare tiles
  // below come from `evenFrames`, which moves them past any dissolve they
  // land in.
  const wanted = [
    0,
    ...marks.map((m) => beatFrame(m, durationFrames, crossfadeFrames)),
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
    for (const frame of evenFrames(
      durationFrames,
      count,
      crossfadeFrames,
      cuts,
    )) {
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

/**
 * The frame a beat is shown at: its mark, moved past the crossfade that
 * starts there — the same frame `markedFrames` puts on a sheet, so asking for
 * a beat by name and looking at its tile are one picture.
 */
export function beatFrame(
  mark: Mark,
  durationFrames: number,
  crossfadeFrames = 0,
): number {
  return mark.frame === 0
    ? 0
    : Math.min(mark.frame + crossfadeFrames, durationFrames - 1);
}

/**
 * Which frame `frame --at <label>` means, or why there is none.
 *
 * By label because matching a beat to a frame number was arithmetic, and an
 * agent got the arithmetic wrong. The exact label first; then a prefix, case
 * ignored, because a label is a phrase someone wrote and the first word is
 * what gets typed back. A prefix that fits several labels is refused rather
 * than settled by order — the wrong beat looked at confidently is worse than
 * a question — and every refusal lists the labels there are.
 */
export function frameAtMark(
  // `marks` optional because recordings made before marks existed have none,
  // whatever the type of a current timeline says.
  timeline: { durationFrames: number; marks?: readonly Mark[] },
  wanted: string,
  crossfadeFrames = 0,
): { frame: number; label: string } | { error: string } {
  const marks = timeline.marks ?? [];
  if (marks.length === 0) {
    return {
      error:
        "This recording has no beats to go by: it has no labelled settle(), or it " +
        "was made before marks existed. Ask for a frame number or --t instead.",
    };
  }
  const labels = [...new Set(marks.map((m) => m.label))];
  const list = labels.map((l) => `  ${JSON.stringify(l)}`).join("\n");

  const exact = marks.find((m) => m.label === wanted);
  const prefix = wanted.toLowerCase();
  const candidates = labels.filter((l) => l.toLowerCase().startsWith(prefix));
  if (!exact && candidates.length > 1) {
    return {
      error: `${JSON.stringify(wanted)} starts more than one beat:\n${candidates
        .map((l) => `  ${JSON.stringify(l)}`)
        .join("\n")}`,
    };
  }
  const mark =
    exact ??
    marks.find((m) => candidates.length === 1 && m.label === candidates[0]);
  if (!mark) {
    return {
      error: `No beat is labelled ${JSON.stringify(wanted)}. The beats:\n${list}`,
    };
  }
  return {
    frame: beatFrame(mark, timeline.durationFrames, crossfadeFrames),
    label: mark.label,
  };
}
