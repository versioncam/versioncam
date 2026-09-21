import { describe, expect, it } from "vitest";
import { clamp, clamp01, lerp, minjerk } from "./easing";
import { between, jitter, seeded } from "./rng";
import {
  cursorEnd,
  distance,
  evalCursor,
  moveDuration,
  planMove,
  targetPoint,
} from "./cursor";
import { typingDuration, typingSchedule } from "./typing";
import type { CursorTrack, Vec2 } from "./timeline";

describe("minjerk", () => {
  it("spans the unit interval and never goes backwards", () => {
    expect(minjerk(0)).toBe(0);
    expect(minjerk(1)).toBe(1);
    let previous = -1;
    for (let i = 0; i <= 1000; i += 1) {
      const value = minjerk(i / 1000);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("starts and stops with no velocity", () => {
    // This is the whole reason for choosing it over a cubic-bezier ease: the
    // cursor must not visibly jerk into motion or slam to a stop.
    const h = 1e-4;
    const startSlope = (minjerk(h) - minjerk(0)) / h;
    const endSlope = (minjerk(1) - minjerk(1 - h)) / h;
    expect(Math.abs(startSlope)).toBeLessThan(1e-3);
    expect(Math.abs(endSlope)).toBeLessThan(1e-3);
  });

  it("clamps outside the unit interval", () => {
    expect(minjerk(-5)).toBe(0);
    expect(minjerk(5)).toBe(1);
  });
});

describe("helpers", () => {
  it("clamps and interpolates", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });
});

describe("seeded", () => {
  it("is reproducible for a seed and different across seeds", () => {
    const a = Array.from({ length: 8 }, seeded(42));
    const b = Array.from({ length: 8 }, seeded(42));
    const c = Array.from({ length: 8 }, seeded(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("stays inside [0, 1)", () => {
    const rng = seeded(7);
    for (let i = 0; i < 5000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("derives bounded values", () => {
    const rng = seeded(3);
    for (let i = 0; i < 200; i += 1) {
      expect(between(rng, 10, 20)).toBeGreaterThanOrEqual(10);
      expect(Math.abs(jitter(rng, 4))).toBeLessThanOrEqual(4);
    }
  });
});

describe("moveDuration", () => {
  it("clamps to a sane range", () => {
    expect(moveDuration(0, 40)).toBe(300);
    expect(moveDuration(100_000, 24)).toBe(900);
  });

  it("takes longer for further targets and for smaller ones", () => {
    expect(moveDuration(600, 40)).toBeGreaterThan(moveDuration(100, 40));
    expect(moveDuration(600, 24)).toBeGreaterThan(moveDuration(600, 200));
  });
});

describe("planMove", () => {
  it("bows the path without moving the endpoints", () => {
    const from: Vec2 = [0, 0];
    const to: Vec2 = [400, 0];
    const segment = planMove(from, to, 1, seeded(1), { targetSize: 40 });

    expect(segment.from).toEqual(from);
    expect(segment.to).toEqual(to);
    expect(segment.t1).toBeGreaterThan(segment.t0);
    // Perpendicular to a horizontal move means the control point is offset in
    // y only, and by a small fraction of the distance.
    expect(segment.ctrl[0]).toBeCloseTo(200, 6);
    expect(Math.abs(segment.ctrl[1])).toBeGreaterThan(0);
    expect(Math.abs(segment.ctrl[1])).toBeLessThanOrEqual(400 * 0.1);
  });

  it("does not bow a zero-length move", () => {
    const segment = planMove([5, 5], [5, 5], 0, seeded(1));
    expect(segment.ctrl).toEqual([5, 5]);
  });

  it("honours an explicit duration", () => {
    const segment = planMove([0, 0], [10, 10], 2, seeded(1), { duration: 500 });
    expect(segment.t1 - segment.t0).toBeCloseTo(0.5, 10);
  });
});

describe("evalCursor", () => {
  const rng = seeded(9);
  const move = planMove([0, 0], [300, 200], 0, rng, { duration: 600 });
  const track: CursorTrack = [
    move,
    { kind: "hold", t0: move.t1, t1: move.t1 + 0.5, at: move.to },
  ];

  it("hits the endpoints exactly", () => {
    expect(evalCursor(track, 0)).toEqual([0, 0]);
    const atEnd = evalCursor(track, move.t1);
    expect(atEnd[0]).toBeCloseTo(300, 6);
    expect(atEnd[1]).toBeCloseTo(200, 6);
  });

  it("holds before the start and after the end", () => {
    expect(evalCursor(track, -1)).toEqual([0, 0]);
    expect(evalCursor(track, 99)).toEqual([300, 200]);
  });

  it("is continuous across the whole track", () => {
    // A discontinuity here would show up as the cursor teleporting mid-clip.
    let previous = evalCursor(track, 0);
    for (let i = 1; i <= 400; i += 1) {
      const t = (i / 400) * (move.t1 + 0.5);
      const current = evalCursor(track, t);
      expect(distance(previous, current)).toBeLessThan(8);
      previous = current;
    }
  });

  it("reports where it finished", () => {
    expect(cursorEnd(track, [0, 0])).toEqual([300, 200]);
    expect(cursorEnd([], [7, 7])).toEqual([7, 7]);
  });
});

describe("targetPoint", () => {
  it("lands inside the middle of the box but not dead centre", () => {
    const box = { x: 100, y: 100, w: 200, h: 80 };
    const rng = seeded(11);
    let exactCentres = 0;
    for (let i = 0; i < 200; i += 1) {
      const [x, y] = targetPoint(box, rng);
      expect(x).toBeGreaterThan(box.x);
      expect(x).toBeLessThan(box.x + box.w);
      expect(y).toBeGreaterThan(box.y);
      expect(y).toBeLessThan(box.y + box.h);
      if (x === 200 && y === 140) exactCentres += 1;
    }
    expect(exactCentres).toBe(0);
  });
});

describe("typingSchedule", () => {
  it("advances monotonically", () => {
    const times = typingSchedule("hello world", seeded(4));
    expect(times).toHaveLength(11);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it("pauses after a space and longer after punctuation", () => {
    // Same seed for both so the only difference is the preceding character.
    const space = typingSchedule("a b", seeded(5));
    const comma = typingSchedule("a,b", seeded(5));
    const spaceGap = space[2] - space[1];
    const commaGap = comma[2] - comma[1];
    expect(commaGap).toBeGreaterThan(spaceGap);
    expect(spaceGap).toBeGreaterThan(80);
  });

  it("reports its own duration", () => {
    const times = typingSchedule("abc", seeded(6));
    expect(typingDuration(times)).toBe(times[2]);
    expect(typingDuration([])).toBe(0);
  });
});
