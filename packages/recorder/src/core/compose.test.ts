import { describe, expect, it } from "vitest";
import { stateForFrame } from "./compose.js";

/** The renderer's default: a settle dissolves over six frames. */
const CROSSFADE = 6;

/** A timeline of `frames` (each the state image a frame shows) and its cuts. */
const timeline = (frames: number[], cuts: number[]) => ({ frames, cuts });

describe("which state a frame shows, and what it crossfades from", () => {
  it("dissolves from the state before a settle into the one after it", () => {
    const t = timeline([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1], [2]);
    const alphas = [3, 4, 5, 6, 7, 8].map((f) => {
      const shown = stateForFrame(t, f, CROSSFADE);
      expect(shown.current).toBe(1);
      expect(shown.previous).toBe(0);
      return shown.alpha;
    });
    expect(alphas.map((a) => a.toFixed(3))).toEqual(
      ["1/6", "2/6", "3/6", "4/6", "5/6", "6/6"].map((f) =>
        (Number(f[0]) / 6).toFixed(3),
      ),
    );
    expect(stateForFrame(t, 9, CROSSFADE)).toEqual({
      current: 1,
      previous: null,
      alpha: 1,
    });
  });

  it("does not dissolve at a settle whose page did not change", () => {
    // A menu that was already open: the same state on both sides of the cut.
    // Reported as a crossfade, the renderer drew the state at a sixth of its
    // opacity over the backdrop, a dip almost to black (0.5.0).
    const t = timeline([4, 4, 4, 4, 4, 4, 4, 4, 4, 4], [2]);
    for (let f = 0; f < t.frames.length; f += 1) {
      expect(stateForFrame(t, f, CROSSFADE)).toEqual({
        current: 4,
        previous: null,
        alpha: 1,
      });
    }
  });

  it("dissolves at a later settle inside an unchanged one's window", () => {
    // Cut 2 changed nothing; cut 4 did, and frame 5 is in both windows.
    const t = timeline([7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8], [2, 4]);
    expect(stateForFrame(t, 3, CROSSFADE).previous).toBeNull();
    expect(stateForFrame(t, 5, CROSSFADE)).toEqual({
      current: 8,
      previous: 7,
      alpha: 1 / 6,
    });
  });

  it("follows the later of two settles whose windows overlap, so a dissolve never runs backwards", () => {
    // Cut 2 brings state 2 in, cut 5 brings state 3 while 2 is still fading.
    const t = timeline([1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3], [2, 5]);
    expect(
      [3, 4, 5].map((f) => stateForFrame(t, f, CROSSFADE).previous),
    ).toEqual([1, 1, 1]);
    const alphas = [6, 7, 8, 9, 10, 11].map((f) => {
      const shown = stateForFrame(t, f, CROSSFADE);
      expect(shown.previous).toBe(2);
      return shown.alpha;
    });
    for (let k = 1; k < alphas.length; k += 1)
      expect(alphas[k]).toBeGreaterThan(alphas[k - 1]);
    expect(alphas.at(-1)).toBe(1);
  });

  it("never draws a frame see-through except over a different state", () => {
    // Every timeline of up to three states over twelve frames with cuts at
    // random: whenever a frame is drawn at less than full opacity, there is a
    // different state under it.
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 2000; run += 1) {
      const frames: number[] = [Math.floor(random() * 3)];
      for (let f = 1; f < 12; f += 1)
        frames.push(random() < 0.3 ? Math.floor(random() * 3) : frames[f - 1]);
      const cuts = [...new Set(frames.map(() => Math.floor(random() * 12)))]
        .filter(() => random() < 0.4)
        .sort((a, b) => a - b);
      for (let f = 0; f < frames.length; f += 1) {
        const shown = stateForFrame({ frames, cuts }, f, CROSSFADE);
        expect(shown.current).toBe(frames[f]);
        if (shown.alpha < 1) {
          expect(shown.previous).not.toBeNull();
          expect(shown.previous).not.toBe(shown.current);
        }
      }
    }
  });
});
