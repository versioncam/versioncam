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
  it("shows the first frame, each beat, and the last", () => {
    expect(markedFrames(601, marksAt(120, 300, 480))).toEqual([
      0, 120, 300, 480, 600,
    ]);
  });

  it("does not repeat a beat that lands on an end", () => {
    // `open()` marks frame 0, and a settle at the very end marks the last
    // frame: both are already there, and a duplicate tile is a wasted one.
    expect(markedFrames(601, marksAt(0, 300, 600))).toEqual([0, 300, 600]);
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
    expect(markedFrames(101, [])).toEqual([0, 100]);
    expect(markedFrames(101, marksAt(-1, 50, 4000))).toEqual([0, 50, 100]);
  });
});
