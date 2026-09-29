import { evalCamera } from "../src/core/camera.js";
import { evalCursor } from "../src/core/cursor.js";
import {
  cameraToStatePixels,
  crossfadeAlpha,
  fadeEnvelope,
  rectToOutput,
  sourceToOutput,
} from "../src/core/compose.js";
import { timeAt } from "../src/core/timeline.js";
import type { Rect, Timeline, Vec2 } from "../src/core/timeline.js";
import {
  captionPlacement,
  frameAreaFor,
  overlayCaptionAnchor,
} from "../src/render/presentation.js";
import type { RenderConfig } from "../src/config.js";
import { CHROME, withAlpha } from "./theme.js";

export type Canvas2D = CanvasRenderingContext2D;

export type Frames = {
  /** Decoded state images, indexed the same way `timeline.states` is. */
  images: (ImageBitmap | HTMLImageElement)[];
};

function roundedRectPath(ctx: Canvas2D, rect: Rect, radius: number): void {
  const r = Math.min(radius, rect.w / 2, rect.h / 2);
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.arcTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, r);
  ctx.arcTo(rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h, r);
  ctx.arcTo(rect.x, rect.y + rect.h, rect.x, rect.y, r);
  ctx.arcTo(rect.x, rect.y, rect.x + rect.w, rect.y, r);
  ctx.closePath();
}

function drawBackdrop(
  ctx: Canvas2D,
  canvas: { width: number; height: number },
  backdrop: [string, string] | string,
): void {
  if (typeof backdrop === "string") {
    ctx.fillStyle = backdrop;
  } else {
    const gradient = ctx.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    gradient.addColorStop(0, backdrop[0]);
    gradient.addColorStop(1, backdrop[1]);
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Which state to show at `frame`, and what to crossfade it with.
 *
 * Only a settle produces a crossfade. Everywhere else a change between
 * consecutive frames is a real one-frame change and must stay crisp —
 * blurring those would smear the cursor's own motion.
 */
export function stateForFrame(
  timeline: Timeline,
  frame: number,
  crossfadeFrames: number,
): { current: number; previous: number | null; alpha: number } {
  for (const cut of timeline.cuts) {
    if (frame > cut && frame <= cut + crossfadeFrames) {
      return {
        current: timeline.frames[frame],
        previous: timeline.frames[cut],
        alpha: crossfadeAlpha(frame, cut + 1, crossfadeFrames),
      };
    }
  }
  return { current: timeline.frames[frame], previous: null, alpha: 1 };
}

function drawApp(
  ctx: Canvas2D,
  timeline: Timeline,
  frames: Frames,
  frame: number,
  camera: Rect,
  frameArea: Rect,
  config: RenderConfig,
): void {
  const source = cameraToStatePixels(camera, timeline.viewport.dpr);
  const { current, previous, alpha } = stateForFrame(
    timeline,
    frame,
    config.motion.crossfadeFrames,
  );
  const framed = config.theme.presentation?.frame ?? false;

  ctx.save();
  // Clipping is only needed when the app has rounded corners to be clipped to.
  if (framed) {
    roundedRectPath(ctx, frameArea, CHROME.radius);
    ctx.clip();
  }

  const paint = (index: number, opacity: number) => {
    const image = frames.images[index];
    if (!image) return;
    ctx.globalAlpha = opacity;
    ctx.drawImage(
      image,
      source.x,
      source.y,
      source.w,
      source.h,
      frameArea.x,
      frameArea.y,
      frameArea.w,
      frameArea.h,
    );
  };

  if (previous !== null && previous !== current) paint(previous, 1);
  paint(current, previous === null ? 1 : alpha);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawFrameChrome(ctx: Canvas2D, frameArea: Rect): void {
  ctx.save();
  ctx.shadowColor = CHROME.shadow;
  ctx.shadowBlur = CHROME.shadowBlur;
  ctx.shadowOffsetY = CHROME.shadowOffsetY;
  ctx.fillStyle = "rgba(0,0,0,1)";
  roundedRectPath(ctx, frameArea, CHROME.radius);
  ctx.fill();
  ctx.restore();
}

function drawHairline(ctx: Canvas2D, frameArea: Rect): void {
  ctx.save();
  ctx.strokeStyle = CHROME.hairline;
  ctx.lineWidth = 1;
  roundedRectPath(ctx, frameArea, CHROME.radius);
  ctx.stroke();
  ctx.restore();
}

function inflate(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    w: rect.w + by * 2,
    h: rect.h + by * 2,
  };
}

function drawHighlights(
  ctx: Canvas2D,
  timeline: Timeline,
  t: number,
  camera: Rect,
  frameArea: Rect,
  config: RenderConfig,
): void {
  const framed = config.theme.presentation?.frame ?? false;

  for (const highlight of timeline.highlights) {
    const opacity = fadeEnvelope(t, highlight.t0, highlight.t1, 0.25);
    if (opacity <= 0) continue;
    const rect = rectToOutput(highlight.rect, camera, frameArea);

    ctx.save();
    ctx.globalAlpha = opacity;
    if (highlight.style === "spotlight") {
      // Dim everything except the target: cheaper on the eye than a ring when
      // the thing being pointed at is large.
      ctx.save();
      roundedRectPath(ctx, frameArea, framed ? CHROME.radius : 0);
      ctx.clip();
      ctx.fillStyle = `rgba(${CHROME.spotlightTint}, ${CHROME.spotlightDim})`;
      ctx.fillRect(frameArea.x, frameArea.y, frameArea.w, frameArea.h);
      ctx.globalCompositeOperation = "destination-out";
      roundedRectPath(ctx, inflate(rect, 8), CHROME.ringRadius);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = config.theme.accent;
      ctx.lineWidth = CHROME.ringWidth;
      ctx.shadowColor = withAlpha(config.theme.accent, 0.35);
      ctx.shadowBlur = 18;
      roundedRectPath(ctx, inflate(rect, 6), CHROME.ringRadius);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Press state and click ripple, derived from the recorded pointer events.
 * Returns the glyph scale for this instant.
 */
function pointerStateAt(
  timeline: Timeline,
  t: number,
  config: RenderConfig,
): { scale: number; ripples: { at: Vec2; age: number }[] } {
  let pressed = false;
  const ripples: { at: Vec2; age: number }[] = [];
  let pressStart = 0;

  for (const event of timeline.pointer) {
    if (event.t > t) break;
    if (event.kind === "down") {
      pressed = true;
      pressStart = event.t;
    } else {
      pressed = false;
      const age = t - event.t;
      if (age >= 0 && age <= config.motion.rippleMs / 1000) {
        ripples.push({ at: event.at, age });
      }
    }
  }

  const pressAge = pressed ? t - pressStart : 0;
  const pressU = pressed
    ? Math.min(1, pressAge / (config.motion.pressScaleMs / 1000))
    : 0;
  const scale = 1 - (1 - config.motion.pressScale) * pressU;
  return { scale, ripples };
}

function drawRipples(
  ctx: Canvas2D,
  ripples: { at: Vec2; age: number }[],
  camera: Rect,
  frameArea: Rect,
  config: RenderConfig,
): void {
  for (const ripple of ripples) {
    const u = ripple.age / (config.motion.rippleMs / 1000);
    const [x, y] = sourceToOutput(ripple.at, camera, frameArea);
    ctx.save();
    ctx.globalAlpha = (1 - u) * 0.55;
    ctx.strokeStyle = config.theme.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 6 + u * config.motion.rippleRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * The cursor glyph: a macOS-style arrow, drawn at a constant size in output
 * pixels so it does not balloon when the camera zooms in.
 */
function drawCursor(
  ctx: Canvas2D,
  at: Vec2,
  scale: number,
  cursorScale: number,
): void {
  const s = cursorScale * scale;
  ctx.save();
  ctx.translate(at[0], at[1]);
  ctx.scale(s, s);

  ctx.shadowColor = CHROME.cursorShadow;
  ctx.shadowBlur = 6 / s;
  ctx.shadowOffsetY = 2 / s;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16.6);
  ctx.lineTo(4.1, 12.9);
  ctx.lineTo(6.9, 18.9);
  ctx.lineTo(9.6, 17.6);
  ctx.lineTo(6.9, 11.8);
  ctx.lineTo(12.1, 11.5);
  ctx.closePath();

  ctx.fillStyle = CHROME.cursorFill;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = CHROME.cursorStroke;
  ctx.lineWidth = 1 / s;
  ctx.stroke();
  ctx.restore();
}

function drawCaption(
  ctx: Canvas2D,
  timeline: Timeline,
  t: number,
  frameArea: Rect,
  canvas: { width: number; height: number },
  config: RenderConfig,
): void {
  const placement = captionPlacement(config.theme.presentation);
  if (placement === "none") return;

  for (const caption of timeline.captions) {
    const opacity = fadeEnvelope(
      t,
      caption.t0,
      caption.t1,
      config.motion.captionFadeS,
    );
    if (opacity <= 0) continue;

    ctx.save();
    ctx.globalAlpha = opacity;

    if (placement === "overlay") {
      // Nothing made room below the app, so the caption sits on it. A scrim
      // keeps it readable over whatever the app happens to be showing.
      const h = CHROME.captionScrimHeight;
      const gradient = ctx.createLinearGradient(
        0,
        canvas.height - h,
        0,
        canvas.height,
      );
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(1, CHROME.captionScrim);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, canvas.height - h, canvas.width, h);
    }

    ctx.font = CHROME.captionFont;
    ctx.fillStyle = CHROME.captionColor;
    ctx.textBaseline = "middle";
    ctx.shadowColor = CHROME.captionShadow;
    ctx.shadowBlur = 8;

    // Over the app, the caption goes where the app's own controls are not.
    // Below it, it lines up with the app's left edge, and covers nothing.
    let x = frameArea.x;
    let y = (frameArea.y + frameArea.h + canvas.height) / 2;
    if (placement === "overlay") {
      const anchor = overlayCaptionAnchor(
        config.theme.presentation,
        canvas.width,
      );
      ctx.textAlign = anchor.align;
      x = anchor.x;
      y = canvas.height - CHROME.captionScrimHeight / 2 + 4;
    }
    ctx.fillText(caption.text, x, y);
    ctx.restore();
  }
}

/**
 * Draw one output frame. A pure function of `frame` — nothing here reads the
 * wall clock, which is what lets the renderer be scrubbed, re-run and
 * byte-compared.
 */
export function drawRecordingFrame(
  ctx: Canvas2D,
  timeline: Timeline,
  frames: Frames,
  frame: number,
  canvas: { width: number; height: number },
  config: RenderConfig,
): void {
  const t = timeAt(frame, timeline.fps);
  const camera = evalCamera(timeline.camera, t);
  const presentation = config.theme.presentation;
  const frameArea = frameAreaFor(canvas, timeline.viewport, presentation);

  // With no presentation the app covers the canvas, so a backdrop would never
  // be seen and the frame chrome would be drawn off the edge.
  if (presentation?.backdrop) drawBackdrop(ctx, canvas, presentation.backdrop);
  if (presentation?.frame) drawFrameChrome(ctx, frameArea);

  drawApp(ctx, timeline, frames, frame, camera, frameArea, config);

  if (presentation?.frame) drawHairline(ctx, frameArea);
  drawHighlights(ctx, timeline, t, camera, frameArea, config);

  const { scale, ripples } = pointerStateAt(timeline, t, config);
  drawRipples(ctx, ripples, camera, frameArea, config);
  drawCursor(
    ctx,
    sourceToOutput(evalCursor(timeline.cursor, t), camera, frameArea),
    scale,
    config.theme.cursorScale,
  );

  drawCaption(ctx, timeline, t, frameArea, canvas, config);
}
