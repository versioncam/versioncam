import { describe, expect, it } from "vitest";
import { captionPlacement, frameAreaFor } from "./presentation";

const CANVAS = { width: 1920, height: 1200 };
const VIEWPORT = { width: 1440, height: 900 };

describe("frameAreaFor", () => {
  it("fills the canvas when there is no presentation", () => {
    // The output aspect is derived from the viewport, so filling is exact.
    expect(frameAreaFor(CANVAS, VIEWPORT, null)).toEqual({
      x: 0,
      y: 0,
      w: 1920,
      h: 1200,
    });
  });

  it("fills the canvas when presentation asks for no padding", () => {
    expect(frameAreaFor(CANVAS, VIEWPORT, { frame: true, padding: 0 })).toEqual(
      {
        x: 0,
        y: 0,
        w: 1920,
        h: 1200,
      },
    );
  });

  it("insets and keeps the aspect when padded", () => {
    const area = frameAreaFor(CANVAS, VIEWPORT, { padding: 0.045 });
    expect(area.x).toBeGreaterThan(0);
    expect(area.y).toBeGreaterThan(0);
    expect(area.x + area.w).toBeLessThanOrEqual(CANVAS.width);
    expect(area.y + area.h).toBeLessThanOrEqual(CANVAS.height);
    expect(area.w / area.h).toBeCloseTo(VIEWPORT.width / VIEWPORT.height, 6);
  });
});

describe("captionPlacement", () => {
  it("overlays when nothing made room below", () => {
    expect(captionPlacement(null)).toBe("overlay");
    expect(captionPlacement({ frame: true })).toBe("overlay");
  });

  it("sits below once there is padding", () => {
    expect(captionPlacement({ padding: 0.045 })).toBe("below");
  });

  it("obeys an explicit choice", () => {
    expect(captionPlacement({ padding: 0.045, caption: "overlay" })).toBe(
      "overlay",
    );
    expect(captionPlacement({ caption: "below" })).toBe("below");
    expect(captionPlacement({ padding: 0.045, caption: "none" })).toBe("none");
  });
});
