import { describe, expect, it } from "vitest";
import { clampRect, evalCamera, scaleOf, zoomRect } from "./camera";
import {
  cameraToStatePixels,
  crossfadeAlpha,
  fadeEnvelope,
  fitFrameArea,
  rectToOutput,
  sourceToOutput,
} from "./compose";
import { catmullRomClosed, loop, resampleByArcLength } from "./loop";
import { seeded } from "./rng";
import { emptyTimeline, frameAt, timeAt, validateTimeline } from "./timeline";
import type { CameraKey, Vec2 } from "./timeline";

const viewport = { width: 1440, height: 900 };

describe("zoomRect", () => {
  it("keeps the viewport aspect", () => {
    const rect = zoomRect({ x: 600, y: 400, w: 100, h: 300 }, viewport);
    expect(rect.w / rect.h).toBeCloseTo(viewport.width / viewport.height, 6);
  });

  it("never magnifies past the cap", () => {
    const tiny = zoomRect({ x: 700, y: 440, w: 10, h: 10 }, viewport);
    expect(scaleOf(tiny, viewport)).toBeLessThanOrEqual(1.85 + 1e-9);
  });

  it("contains the target it was asked to frame", () => {
    const target = { x: 300, y: 200, w: 400, h: 150 };
    const rect = zoomRect(target, viewport);
    expect(rect.x).toBeLessThanOrEqual(target.x);
    expect(rect.y).toBeLessThanOrEqual(target.y);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(target.x + target.w);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(target.y + target.h);
  });

  it("stays inside the captured area even for targets at the edge", () => {
    const rect = zoomRect({ x: 1400, y: 870, w: 40, h: 30 }, viewport);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(viewport.width + 1e-9);
    expect(rect.y + rect.h).toBeLessThanOrEqual(viewport.height + 1e-9);
  });

  it("never exceeds the viewport for a huge target", () => {
    const rect = zoomRect({ x: -500, y: -500, w: 5000, h: 5000 }, viewport);
    expect(rect).toEqual({ x: 0, y: 0, w: 1440, h: 900 });
  });

  it("clamps a rectangle into the viewport", () => {
    expect(clampRect({ x: -50, y: -50, w: 200, h: 100 }, viewport)).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
  });
});

describe("evalCamera", () => {
  const full = { x: 0, y: 0, w: 1440, h: 900 };
  const zoomed = { x: 200, y: 150, w: 800, h: 500 };
  const keys: CameraKey[] = [
    { t: 0, rect: full, ease: "hold" },
    { t: 1, rect: zoomed, ease: "minjerk" },
    { t: 2, rect: zoomed, ease: "hold" },
  ];

  it("hits its keys exactly", () => {
    expect(evalCamera(keys, 0)).toEqual(full);
    expect(evalCamera(keys, 1)).toEqual(zoomed);
    expect(evalCamera(keys, 5)).toEqual(zoomed);
  });

  it("eases between keys", () => {
    const mid = evalCamera(keys, 0.5);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(zoomed.x);
  });

  it("holds through a hold key", () => {
    expect(evalCamera(keys, 1.5)).toEqual(zoomed);
  });

  it("throws rather than guessing when it has no keys", () => {
    expect(() => evalCamera([], 0)).toThrow();
  });
});

describe("compose", () => {
  const frameArea = { x: 100, y: 50, w: 1440, h: 900 };

  it("is the identity (plus offset) when the camera is the whole viewport", () => {
    const camera = { x: 0, y: 0, w: 1440, h: 900 };
    expect(sourceToOutput([10, 20], camera, frameArea)).toEqual([110, 70]);
  });

  it("scales when the camera is zoomed in", () => {
    const camera = { x: 200, y: 150, w: 720, h: 450 };
    const point = sourceToOutput([200, 150], camera, frameArea);
    expect(point).toEqual([100, 50]);
    const rect = rectToOutput(
      { x: 200, y: 150, w: 72, h: 45 },
      camera,
      frameArea,
    );
    expect(rect.w).toBeCloseTo(144, 6);
    expect(rect.h).toBeCloseTo(90, 6);
  });

  it("converts a camera into state pixels", () => {
    expect(cameraToStatePixels({ x: 10, y: 20, w: 30, h: 40 }, 2)).toEqual({
      x: 20,
      y: 40,
      w: 60,
      h: 80,
    });
  });

  it("fits the app frame inside the canvas with padding", () => {
    const area = fitFrameArea({ width: 1920, height: 1080 }, viewport, 0.04);
    expect(area.w / area.h).toBeCloseTo(viewport.width / viewport.height, 6);
    expect(area.x).toBeGreaterThan(0);
    expect(area.y).toBeGreaterThan(0);
    expect(area.x + area.w).toBeLessThanOrEqual(1920);
    expect(area.y + area.h).toBeLessThanOrEqual(1080);
  });

  it("fades a cut in over its length", () => {
    expect(crossfadeAlpha(9, 10, 6)).toBe(0);
    expect(crossfadeAlpha(10, 10, 6)).toBeCloseTo(1 / 6, 6);
    expect(crossfadeAlpha(15, 10, 6)).toBe(1);
    expect(crossfadeAlpha(100, 10, 6)).toBe(1);
    expect(crossfadeAlpha(10, 10, 0)).toBe(1);
  });

  it("envelopes a caption in and out", () => {
    expect(fadeEnvelope(0, 1, 5, 0.3)).toBe(0);
    expect(fadeEnvelope(1.15, 1, 5, 0.3)).toBeCloseTo(0.5, 6);
    expect(fadeEnvelope(3, 1, 5, 0.3)).toBe(1);
    expect(fadeEnvelope(4.85, 1, 5, 0.3)).toBeCloseTo(0.5, 6);
    expect(fadeEnvelope(6, 1, 5, 0.3)).toBe(0);
  });
});

describe("lasso loops", () => {
  it("closes the ring", () => {
    const points: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const path = catmullRomClosed(points, 8);
    expect(path[0]).toEqual(path[path.length - 1]);
    expect(path.length).toBe(points.length * 8 + 1);
  });

  it("passes through every control point", () => {
    const points: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const path = catmullRomClosed(points, 8);
    for (const point of points) {
      const hit = path.some(
        ([x, y]) =>
          Math.abs(x - point[0]) < 1e-9 && Math.abs(y - point[1]) < 1e-9,
      );
      expect(hit).toBe(true);
    }
  });

  it("returns short inputs untouched", () => {
    expect(catmullRomClosed([[1, 1]], 4)).toEqual([[1, 1]]);
  });

  it("plans a loop inside its target box", () => {
    const box = { x: 100, y: 100, w: 400, h: 300 };
    const path = loop([
      [0.3, 0.3],
      [0.7, 0.3],
      [0.7, 0.7],
      [0.3, 0.7],
    ])(box, seeded(2));
    for (const [x, y] of path) {
      expect(x).toBeGreaterThan(box.x);
      expect(x).toBeLessThan(box.x + box.w);
      expect(y).toBeGreaterThan(box.y);
      expect(y).toBeLessThan(box.y + box.h);
    }
  });

  it("resamples to even spacing", () => {
    // Uneven input: one long leg, one short.
    const path: Vec2[] = [
      [0, 0],
      [100, 0],
      [110, 0],
    ];
    const even = resampleByArcLength(path, 12);
    expect(even).toHaveLength(12);
    const gaps: number[] = [];
    for (let i = 1; i < even.length; i += 1) {
      gaps.push(
        Math.hypot(even[i][0] - even[i - 1][0], even[i][1] - even[i - 1][1]),
      );
    }
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    expect(max - min).toBeLessThan(1e-6);
  });

  it("handles degenerate resampling inputs", () => {
    // A zero-length path still has to yield `count` points: the caller feeds
    // them to one mouse move per frame and a short array would end the stroke
    // early.
    expect(resampleByArcLength([], 5)).toEqual([]);
    expect(resampleByArcLength([[3, 3]], 5)).toEqual([
      [3, 3],
      [3, 3],
      [3, 3],
      [3, 3],
      [3, 3],
    ]);
    expect(
      resampleByArcLength(
        [
          [3, 3],
          [3, 3],
        ],
        4,
      ),
    ).toHaveLength(4);
    expect(
      resampleByArcLength(
        [
          [0, 0],
          [9, 9],
        ],
        1,
      ),
    ).toEqual([[0, 0]]);
  });
});

describe("timeline", () => {
  const init = {
    clipId: "test",
    fps: 60,
    viewport: { width: 1440, height: 900, dpr: 2 },
    title: "Test",
    appCommit: "abc1234",
    baseUrl: "http://localhost:5273",
    recordedAt: "2026-09-01T09:00:00Z",
  };

  it("opens with a full-viewport camera key", () => {
    const timeline = emptyTimeline(init);
    expect(timeline.camera).toHaveLength(1);
    expect(timeline.camera[0]).toEqual({
      t: 0,
      rect: { x: 0, y: 0, w: 1440, h: 900 },
      ease: "hold",
    });
    expect(validateTimeline(timeline)).toEqual([]);
  });

  it("converts between frames and time", () => {
    expect(frameAt(1, 60)).toBe(60);
    expect(timeAt(60, 60)).toBe(1);
    expect(frameAt(timeAt(137, 60), 60)).toBe(137);
  });

  it("reports the invariants the renderer depends on", () => {
    const timeline = emptyTimeline(init);
    timeline.durationFrames = 3;
    timeline.frames = [0, 0];
    expect(validateTimeline(timeline)).toContain(
      "frames has 2 entries but durationFrames is 3",
    );

    timeline.frames = [0, 1, 0];
    timeline.states = ["a.png"];
    expect(validateTimeline(timeline)).toContain(
      "frames[1] = 1 is not a valid state index",
    );

    const unsorted = emptyTimeline(init);
    unsorted.camera.push({
      t: 5,
      rect: unsorted.camera[0].rect,
      ease: "minjerk",
    });
    unsorted.camera.push({
      t: 2,
      rect: unsorted.camera[0].rect,
      ease: "minjerk",
    });
    expect(validateTimeline(unsorted)).toContain(
      "camera keys are not sorted by time",
    );
  });
});
