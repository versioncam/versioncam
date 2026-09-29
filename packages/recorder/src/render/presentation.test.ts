import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Presentation } from "../config.js";
import {
  captionPlacement,
  frameAreaFor,
  overlayCaptionAnchor,
} from "./presentation.js";

const CANVAS = { width: 1920, height: 1200 };
const VIEWPORT = { width: 1440, height: 900 };

describe("overlayCaptionAnchor", () => {
  it("sits 40 pixels in from the left unless told otherwise", () => {
    // Where the caption always sat, before it could be moved.
    expect(overlayCaptionAnchor(null, 1920)).toEqual({ x: 40, align: "left" });
    expect(overlayCaptionAnchor({ caption: "overlay" }, 1920)).toEqual({
      x: 40,
      align: "left",
    });
  });

  it("measures from the side it names, and runs away from it", () => {
    expect(overlayCaptionAnchor({ captionInset: { left: 380 } }, 1920)).toEqual(
      { x: 380, align: "left" },
    );
    // Right-aligned, so the caption ends 40 pixels short of the right edge
    // however long it is.
    expect(overlayCaptionAnchor({ captionInset: { right: 40 } }, 1920)).toEqual(
      { x: 1880, align: "right" },
    );
  });
});

/**
 * Every field of `Presentation`, by name. The compiler holds this object to
 * the type, both ways: a field left out is missing, and one the type does not
 * have is excess.
 */
const PRESENTATION: Record<keyof Presentation, true> = {
  backdrop: true,
  frame: true,
  padding: true,
  caption: true,
  captionInset: true,
};

describe("the README's presentation table", () => {
  // The README is also version.cam's documentation. A field it lists that
  // the config does not have, or the reverse, is a promise to strangers.
  it("names every field of Presentation, and nothing else", () => {
    const readme = readFileSync(
      new URL("../../README.md", import.meta.url),
      "utf8",
    );
    const section =
      readme.split(/^### Presentation$/m)[1]?.split(/^##/m)[0] ?? "";
    const fields = [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
    expect(fields.sort()).toEqual(Object.keys(PRESENTATION).sort());
  });
});

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
