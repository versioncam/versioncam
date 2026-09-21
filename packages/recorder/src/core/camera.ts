import { clamp, lerp, minjerk } from "./easing.js";
import type { CameraKey, Rect } from "./timeline.js";

export type Viewport = { width: number; height: number };

export type ZoomOptions = {
  /** Padding around the target, as a fraction of its size. */
  pad?: number;
  /**
   * Hard ceiling on magnification. Above the ratio of capture DPR to output
   * scale the image is being upscaled, and the whole point of capturing at
   * DPR 2 is that a zoom stays sharp.
   */
  maxScale?: number;
};

const DEFAULT_PAD = 0.12;
const DEFAULT_MAX_SCALE = 1.65;

export function clampRect(rect: Rect, viewport: Viewport): Rect {
  const w = Math.min(rect.w, viewport.width);
  const h = Math.min(rect.h, viewport.height);
  return {
    x: clamp(rect.x, 0, viewport.width - w),
    y: clamp(rect.y, 0, viewport.height - h),
    w,
    h,
  };
}

/**
 * The camera rectangle that frames `target`: padded, fitted to the viewport's
 * aspect (the output frame has the viewport's shape, so anything else would
 * letterbox), capped in magnification, and kept inside the captured area.
 */
export function zoomRect(
  target: Rect,
  viewport: Viewport,
  options: ZoomOptions = {},
): Rect {
  const pad = options.pad ?? DEFAULT_PAD;
  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;
  const aspect = viewport.width / viewport.height;

  const centerX = target.x + target.w / 2;
  const centerY = target.y + target.h / 2;

  let w = target.w * (1 + 2 * pad);
  let h = target.h * (1 + 2 * pad);

  // Grow the deficient axis rather than shrinking the other, so the target
  // never gets cropped by the aspect fit.
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;

  const minWidth = viewport.width / maxScale;
  if (w < minWidth) {
    w = minWidth;
    h = w / aspect;
  }
  if (w > viewport.width) {
    w = viewport.width;
    h = viewport.height;
  }

  return clampRect({ x: centerX - w / 2, y: centerY - h / 2, w, h }, viewport);
}

/** The magnification a camera rectangle represents. */
export function scaleOf(rect: Rect, viewport: Viewport): number {
  return viewport.width / rect.w;
}

/**
 * Interpolate one camera framing towards another.
 *
 * The size moves geometrically and the centre linearly. Interpolating width
 * linearly is the usual reason a zoom feels wrong: going from 1440 wide to 780
 * wide, the first half of the move changes the magnification by 1.22x and the
 * second half by 1.51x, so a zoom that is mathematically even reads as rushing
 * into the target and then crawling. In log space each equal step multiplies
 * the scale by the same factor, which is what the eye actually reads as
 * constant speed.
 */
function interpolateRect(a: Rect, b: Rect, u: number): Rect {
  const cxA = a.x + a.w / 2;
  const cyA = a.y + a.h / 2;
  const cxB = b.x + b.w / 2;
  const cyB = b.y + b.h / 2;

  const w = a.w * Math.pow(b.w / a.w, u);
  const h = a.h * Math.pow(b.h / a.h, u);
  const cx = lerp(cxA, cxB, u);
  const cy = lerp(cyA, cyB, u);

  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Where the camera is at time `t`. A key's `ease` describes how the camera
 * reaches it from the previous key: `minjerk` glides, `hold` stays put and
 * then cuts.
 */
export function evalCamera(keys: CameraKey[], t: number): Rect {
  if (keys.length === 0) {
    throw new Error("evalCamera called with no keys");
  }
  if (t <= keys[0].t) return keys[0].rect;

  for (let i = 1; i < keys.length; i += 1) {
    const prev = keys[i - 1];
    const next = keys[i];
    if (t >= next.t) continue;
    if (next.ease === "hold") return prev.rect;
    const span = next.t - prev.t;
    const u = span <= 0 ? 1 : (t - prev.t) / span;
    return interpolateRect(prev.rect, next.rect, minjerk(u));
  }

  return keys[keys.length - 1].rect;
}
