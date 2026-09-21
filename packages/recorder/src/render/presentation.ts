import { fitFrameArea } from "../core/compose";
import type { Presentation } from "../config";
import type { Rect } from "../core/timeline";

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
