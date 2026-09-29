import { fitFrameArea } from "../core/compose.js";
import type { Presentation } from "../config.js";
import type { Rect } from "../core/timeline.js";

/**
 * Where the captured app is drawn inside the output canvas.
 *
 * With no presentation the app fills the canvas edge to edge, which is exact
 * rather than approximate: the output's aspect is derived from the viewport's,
 * so there is nothing to letterbox. Presentation insets it to make room for a
 * backdrop and a frame.
 */
export function frameAreaFor(
  canvas: { width: number; height: number },
  viewport: { width: number; height: number },
  presentation: Presentation | null,
): Rect {
  const padding = presentation?.padding ?? 0;
  if (!presentation || padding <= 0) {
    return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  }
  return fitFrameArea(canvas, viewport, padding);
}

/** Whether the caption sits under the app or over it. */
export function captionPlacement(
  presentation: Presentation | null,
): "below" | "overlay" | "none" {
  const mode = presentation?.caption ?? "auto";
  if (mode === "none") return "none";
  if (mode === "below" || mode === "overlay") return mode;
  // "auto": there is only room below the app if something made room.
  return (presentation?.padding ?? 0) > 0 ? "below" : "overlay";
}

/**
 * Where an overlay caption's text is anchored, and which way it runs from
 * there: from `x` rightwards, or leftwards to it.
 *
 * Measured from the video's edge rather than the app's, so the default is
 * exactly where the caption sat before it could be moved, padded or not:
 * 40 pixels in from the left.
 */
export function overlayCaptionAnchor(
  presentation: Presentation | null,
  canvasWidth: number,
): { x: number; align: "left" | "right" } {
  const inset = presentation?.captionInset;
  if (inset?.right !== undefined) {
    return { x: canvasWidth - inset.right, align: "right" };
  }
  return { x: inset?.left ?? 40, align: "left" };
}
