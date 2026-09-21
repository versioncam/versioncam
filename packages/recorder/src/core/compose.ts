import { clamp01 } from "./easing.js";
import type { Rect, Vec2 } from "./timeline.js";

/**
 * Mapping from the captured page into the output frame.
 *
 * Three spaces are in play and confusing them is the easiest way to get a
 * cursor that drifts away from what it is clicking:
 *
 *  - **viewport space** — CSS pixels, what the timeline stores.
 *  - **state space** — pixels inside a captured PNG: viewport × dpr.
 *  - **output space** — pixels in the rendered video frame.
 *
 * `camera` is a rectangle in viewport space; `frameArea` is where the app
 * image is drawn in output space. Everything else follows from those two.
 */

export function sourceToOutput(
  point: Vec2,
  camera: Rect,
  frameArea: Rect,
): Vec2 {
  const scale = frameArea.w / camera.w;
  return [
    frameArea.x + (point[0] - camera.x) * scale,
    frameArea.y + (point[1] - camera.y) * scale,
  ];
}

export function rectToOutput(rect: Rect, camera: Rect, frameArea: Rect): Rect {
  const scale = frameArea.w / camera.w;
  return {
    x: frameArea.x + (rect.x - camera.x) * scale,
    y: frameArea.y + (rect.y - camera.y) * scale,
    w: rect.w * scale,
    h: rect.h * scale,
  };
}

/** The source rectangle to read out of a state image, in state pixels. */
export function cameraToStatePixels(camera: Rect, dpr: number): Rect {
  return {
    x: camera.x * dpr,
    y: camera.y * dpr,
    w: camera.w * dpr,
    h: camera.h * dpr,
  };
}

/**
 * Fit a viewport-shaped image into `canvas` with `padding` (a fraction of the
 * smaller canvas dimension) around it. This is the rounded "device frame" the
 * app sits in.
 */
export function fitFrameArea(
  canvas: { width: number; height: number },
  viewport: { width: number; height: number },
  padding: number,
): Rect {
  const inset = Math.min(canvas.width, canvas.height) * padding;
  const availableW = canvas.width - inset * 2;
  const availableH = canvas.height - inset * 2;
  const aspect = viewport.width / viewport.height;

  let w = availableW;
  let h = w / aspect;
  if (h > availableH) {
    h = availableH;
    w = h * aspect;
  }
  return {
    x: (canvas.width - w) / 2,
    y: (canvas.height - h) / 2,
    w,
    h,
  };
}

/**
 * Opacity of the *new* state during a crossfade that starts at `cutFrame` and
 * lasts `length` frames. Frame `cutFrame` itself is already partly faded, so
 * a cut never shows a duplicated still.
 */
export function crossfadeAlpha(
  frame: number,
  cutFrame: number,
  length: number,
): number {
  if (length <= 0) return 1;
  return clamp01((frame - cutFrame + 1) / length);
}

/** Linear fade in/out envelope, in seconds, for captions and highlights. */
export function fadeEnvelope(
  t: number,
  t0: number,
  t1: number,
  fade: number,
): number {
  if (t <= t0 || t >= t1) return 0;
  if (fade <= 0) return 1;
  return Math.min(clamp01((t - t0) / fade), clamp01((t1 - t) / fade));
}
