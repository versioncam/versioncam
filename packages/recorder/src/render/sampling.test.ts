import { describe, expect, it } from "vitest";
import { markedFrames, uniformFrames } from "./sampling.js";

const marksAt = (...frames: number[]) =>
  frames.map((frame, index) => ({ frame, label: `beat ${index}` }));

describe("uniformFrames", () => {
  it("spans the clip, ends included", () => {
    expect(uniformFrames(601)).toEqual([0, 86, 171, 257, 343, 429, 514, 600]);
  });

  it("never asks for a frame a short clip does not have", () => {
    expect(uniformFrames(3)).toEqual([0, 1, 2]);
    expect(uniformFrames(1)).toEqual([0, 0]);
  });
});

describe("markedFrames", () => {
  // A beat is what the sheet may not miss, not all it may show. Every one of
  // these keeps the ends and every beat; the spare tiles go to an even spread
  // across the rest, because a clip whose middle six seconds appear in no tile
  // is one a reviewer cannot judge.
  const beatsIn = (frames: number[], beats: number[]) => {
    for (const beat of beats) expect(frames).toContain(beat);
    expect(frames[0]).toBe(0);
    expect([...frames].sort((a, b) => a - b)).toEqual(frames);
    expect(new Set(frames).size).toBe(frames.length);
  };

  it("shows the first frame, each beat, the last, and fills the rest", () => {
    const frames = markedFrames(601, marksAt(120, 300, 480));
    beatsIn(frames, [120, 300, 480]);
    expect(frames.at(-1)).toBe(600);
    expect(frames).toHaveLength(8);
  });

  it("does not repeat a beat that lands on an end", () => {
    // `open()` marks frame 0, and a settle at the very end marks the last
    // frame: both are already there, and a duplicate tile is a wasted one.
    const frames = markedFrames(601, marksAt(0, 300, 600));
    beatsIn(frames, [300]);
    expect(frames.at(-1)).toBe(600);
    expect(new Set(frames).size).toBe(frames.length);
  });

  it("keeps the ends and thins the middle when there are more beats than tiles", () => {
    const many = marksAt(10, 20, 30, 40, 50, 60, 70, 80, 90, 100);
    const chosen = markedFrames(201, many);
    expect(chosen).toHaveLength(8);
    expect(chosen[0]).toBe(0);
    expect(chosen.at(-1)).toBe(200);
    // Every tile is a real beat (or an end), in order, without repeats.
    expect([...chosen].sort((a, b) => a - b)).toEqual(chosen);
    expect(new Set(chosen).size).toBe(chosen.length);
    for (const frame of chosen.slice(1, -1)) {
      expect(many.map((m) => m.frame)).toContain(frame);
    }
  });

  it("ignores a mark outside the clip rather than asking for a frame that is not there", () => {
    // A recording made before marks existed has none at all, and a hand-edited
    // timeline can say anything; neither may produce a tile request the render
    // page cannot answer.
    // With no usable mark there is nothing to guarantee, so the sheet is the
    // even spread it would have been without the flag.
    expect(markedFrames(101, [])).toEqual(uniformFrames(101));
    const frames = markedFrames(101, marksAt(-1, 50, 4000));
    expect(frames).toContain(50);
    expect(frames[0]).toBe(0);
    expect(frames.at(-1)).toBe(100);
  });
});

describe("sampling past a crossfade", () => {
  it("shows the settled page, not the dissolve into it", () => {
    // A mark is the first frame of the settled state, which is also the first
    // frame of the renderer's crossfade: at the mark the tile is still mostly
    // the page as it was before the wait. Six frames later the dissolve has
    // finished. This is the bug the example app's first authored clip found —
    // its one beat rendered as the old list with the new one ghosting through.
    const frames = markedFrames(149, marksAt(0, 29), 8, 6);
    expect(frames).toContain(35);
    expect(frames).not.toContain(29);
  });

  it("never samples past the end", () => {
    // 37 + 6 would be 43, which is not a frame this clip has.
    expect(Math.max(...markedFrames(40, marksAt(0, 37), 8, 6))).toBe(39);
  });

  it("leaves the beat where it is when nothing crossfades", () => {
    expect(markedFrames(149, marksAt(0, 29), 8, 0)).toContain(29);
  });
});

describe("filling the grid", () => {
  it("keeps every beat and spends the spare tiles on the rest of the clip", () => {
    const frames = markedFrames(149, marksAt(0, 29), 8, 6);
    // The beat, moved past the crossfade, survives the fill.
    expect(frames).toContain(35);
    expect(frames).not.toContain(29);
    expect(frames[0]).toBe(0);
    expect(frames[frames.length - 1]).toBe(148);
    expect(frames.length).toBe(8);
    expect([...frames].sort((a, b) => a - b)).toEqual(frames);
  });

  it("still thins when the beats alone overflow the grid", () => {
    const many = marksAt(...Array.from({ length: 20 }, (_, i) => i * 10 + 1));
    expect(markedFrames(201, many, 8, 0).length).toBeLessThanOrEqual(8);
  });
});

describe("no tile is two pages at once", () => {
  it("moves an evenly spread tile that lands inside a dissolve", () => {
    // Not only the beats: a reviewer flagged a filled tile as a
    // "mid-transition double-exposure" on a clip whose mark was already clear.
    const frames = markedFrames(149, marksAt(0), 8, 6, [20]);
    for (const f of frames) {
      expect(f > 20 && f <= 26).toBe(false);
    }
  });

  it("leaves tiles alone that are nowhere near a cut", () => {
    expect(markedFrames(149, marksAt(0), 8, 6, [140])).toContain(21);
  });
});
