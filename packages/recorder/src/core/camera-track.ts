import { interpolateRect } from "./camera.js";
import type { Viewport } from "./camera.js";
import { minjerk } from "./easing.js";
import { followCentres } from "./follow.js";
import type { FollowSpec } from "./follow.js";
import { frameAt, timeAt } from "./timeline.js";
import type { CameraKey, CursorTrack, Rect, Vec2 } from "./timeline.js";

/**
 * What a clip asked the camera to do, and when: one per `s.camera.*` call.
 *
 * The session keeps these rather than writing camera keys as it goes,
 * because a camera that follows the cursor depends on where the cursor goes
 * *after* the write, and that is only known once the clip has run. The
 * driver never needs the camera while it records: it captures the whole
 * viewport, and the camera is a crop drawn afterwards.
 */
export type CameraWrite =
  /** `zoom`, `to` and `reset`: glide to a framing and stay there. */
  | { t: number; kind: "frame"; rect: Rect; durationMs: number }
  /** Follow the cursor, until the next write. */
  | { t: number; kind: "follow"; spec: FollowSpec; durationMs: number }
  /** Stop following, and come to rest on the framing the follow was heading for. */
  | { t: number; kind: "release" };

export type TrackContext = {
  viewport: Viewport;
  fps: number;
  durationFrames: number;
  cursor: CursorTrack;
  /** Where the cursor rests before the track's first step. */
  cursorStart: Vec2;
};

/** A write that moves the camera somewhere, with what the follow needs precomputed. */
type Mover = {
  t: number;
  /** Seconds. */
  duration: number;
  destination: (frame: number) => Rect;
};

/**
 * Turn a clip's camera writes into the keys the renderer interpolates.
 *
 * Every write starts from where the camera is, moving or not, and blends
 * from there to where it is going:
 *
 *     camera(t) = interpolateRect(before(t), destination(t), minjerk(u))
 *
 * where `before` is the camera as it would have gone on without this write,
 * and `u` runs from 0 to 1 over the write's duration. Min-jerk has no slope
 * at either end, so the camera's velocity is continuous where a blend starts
 * and where it ends: entering a follow from a keyed zoom, leaving it for a
 * reset, or a zoom written while another is still under way. That last one
 * used to wait for the move before it to finish and then run short, because
 * each glide set off from the previous glide's target.
 *
 * A clip that never follows and never writes a move while another is under
 * way gets exactly the keys it always got: a hold where each write starts and
 * a min-jerk key where it ends. Every other clip gets the camera sampled at
 * each frame (the `"linear"` keys), since a blend between two moving framings
 * is no longer a glide between two keys.
 */
export function cameraTrack(
  writes: readonly CameraWrite[],
  context: TrackContext,
): CameraKey[] {
  const { viewport } = context;
  const full: Rect = { x: 0, y: 0, w: viewport.width, h: viewport.height };
  const opening: CameraKey = { t: 0, rect: full, ease: "hold" };

  const effective = effectiveWrites(writes);
  if (glidesOnly(effective)) return glideKeys(effective, opening);
  return sampledKeys(effective, context, full);
}

type FrameWrite = Extract<CameraWrite, { kind: "frame" }>;

/**
 * Whether every write is a framing that starts once the one before it has
 * arrived: the only case the old keys describe exactly.
 */
function glidesOnly(writes: readonly CameraWrite[]): writes is FrameWrite[] {
  let arrived = 0;
  for (const write of writes) {
    if (write.kind !== "frame" || write.t < arrived) return false;
    // The same expression the key's time is computed with below, so the
    // comparison is between the same two doubles the keys will hold.
    arrived = write.t + write.durationMs / 1000;
  }
  return true;
}

/**
 * The keys the session wrote before it could follow: hold the current
 * framing until the write, then glide. Kept to the byte, so no recording of
 * a clip that only zooms changes.
 */
function glideKeys(writes: FrameWrite[], opening: CameraKey): CameraKey[] {
  const keys: CameraKey[] = [opening];
  for (const write of writes) {
    const last = keys[keys.length - 1];
    if (last.t < write.t) {
      keys.push({ t: write.t, rect: last.rect, ease: "hold" });
    }
    keys.push({
      t: write.t + write.durationMs / 1000,
      rect: write.rect,
      ease: "minjerk",
    });
  }
  return keys;
}

/**
 * The writes that take effect.
 *
 * A release with no follow to release is nothing to do. A write replaces an
 * earlier one at the same instant that was still to take time: two moves
 * written together are one intention stated twice, and blending the first
 * under the second would bend the camera towards a framing no frame was
 * meant to show. A cut (duration 0) at the same instant is kept, since it has
 * already happened by the time the next write starts from it.
 */
function effectiveWrites(writes: readonly CameraWrite[]): CameraWrite[] {
  const effective: CameraWrite[] = [];
  for (const write of writes) {
    const last = effective[effective.length - 1];
    if (write.kind === "release") {
      if (last?.kind === "follow") effective.push(write);
      continue;
    }
    while (effective.length > 0) {
      const previous = effective[effective.length - 1];
      if (
        previous.kind === "release" ||
        previous.t !== write.t ||
        previous.durationMs <= 0
      ) {
        break;
      }
      effective.pop();
    }
    effective.push(write);
  }
  return effective;
}

/** The first frame whose time is at or after `t`. */
function firstFrameFrom(t: number, fps: number): number {
  let frame = Math.max(0, Math.ceil(t * fps - 1e-9));
  while (timeAt(frame, fps) < t) frame += 1;
  while (frame > 0 && timeAt(frame - 1, fps) >= t) frame -= 1;
  return frame;
}

/** To a thousandth of a pixel: far below anything a frame can show. */
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A sample, rounded, so a camera at rest compares equal to itself from one
 * frame to the next and its run of samples collapses to two.
 *
 * Rounding may not carry an edge that was inside the page outside it: a
 * frame at the page's right edge is `x + w = width` exactly, and rounding
 * each half up would put a thousandth of a pixel of nothing in the picture.
 */
function roundRect(rect: Rect, viewport: Viewport): Rect {
  const w = round(rect.w);
  const h = round(rect.h);
  return {
    x: roundInside(rect.x, rect.w, w, viewport.width),
    y: roundInside(rect.y, rect.h, h, viewport.height),
    w,
    h,
  };
}

/**
 * One edge's position, rounded, and kept inside `[0, limit]` if it was
 * inside to begin with, give or take the last bit of a double: a frame
 * centred as far right as it goes is `x + w = width` only up to the float
 * arithmetic that centred it. A rectangle a clip asked for outside the page
 * (`camera.to` accepts one) is left where it was asked for.
 */
function roundInside(
  start: number,
  size: number,
  rounded: number,
  limit: number,
): number {
  const slack = 1e-6;
  const at = round(start);
  if (start < -slack || start + size > limit + slack) return at;
  if (at < 0) return 0;
  if (at + rounded > limit) return Math.floor((limit - rounded) * 1000) / 1000;
  return at;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function sampledKeys(
  effective: readonly CameraWrite[],
  context: TrackContext,
  full: Rect,
): CameraKey[] {
  const { fps, viewport } = context;
  const lastFrame = context.durationFrames - 1;

  // Sampled through the last frame and then on, past it, until every write
  // has arrived: a move still running when the clip ends leaves keys after
  // the end, as a glide's key after the end always has, and that is what
  // `review` warns about.
  let endFrame = lastFrame;
  for (const write of effective) {
    if (write.kind === "release") continue;
    endFrame = Math.max(
      endFrame,
      frameAt(write.t + write.durationMs / 1000, fps),
    );
  }

  const movers: Mover[] = [];
  effective.forEach((write, index) => {
    if (write.kind === "release") return;
    const duration = write.durationMs / 1000;
    if (write.kind === "frame") {
      const rect = write.rect;
      movers.push({ t: write.t, duration, destination: () => rect });
      return;
    }
    // A follow reads the cursor until the next write of any kind, release
    // included.
    const next = effective[index + 1];
    const firstFrame = firstFrameFrom(write.t, fps);
    const centres = followCentres({
      cursor: context.cursor,
      cursorStart: context.cursorStart,
      viewport,
      fps,
      spec: write.spec,
      firstFrame,
      lastFrame: endFrame,
      until: next ? next.t : Number.POSITIVE_INFINITY,
    });
    const w = viewport.width / write.spec.scale;
    const h = viewport.height / write.spec.scale;
    movers.push({
      t: write.t,
      duration,
      destination: (frame) => {
        const [cx, cy] = centres[frame - firstFrame];
        return { x: cx - w / 2, y: cy - h / 2, w, h };
      },
    });
  });

  // The camera at a frame: the latest write that has started, blended with
  // the camera as it was going before it, for as long as the blend lasts.
  const cameraAt = (index: number, frame: number, t: number): Rect => {
    if (index < 0) return full;
    const mover = movers[index];
    const destination = mover.destination(frame);
    const u = mover.duration > 0 ? (t - mover.t) / mover.duration : 1;
    if (u >= 1) return destination;
    return interpolateRect(
      cameraAt(index - 1, frame, t),
      destination,
      minjerk(u),
    );
  };

  const keys: CameraKey[] = [];
  let latest = -1;
  for (let frame = 0; frame <= endFrame; frame += 1) {
    const t = timeAt(frame, fps);
    while (latest + 1 < movers.length && movers[latest + 1].t <= t) {
      latest += 1;
    }
    const rect = roundRect(cameraAt(latest, frame, t), viewport);
    keys.push({ t, rect, ease: frame === 0 ? "hold" : "linear" });
  }

  // Where the camera is still, only the two ends of the stillness matter:
  // between two equal samples, every sample is the same.
  return keys.filter(
    (key, i) =>
      i === 0 ||
      i === keys.length - 1 ||
      !sameRect(keys[i - 1].rect, key.rect) ||
      !sameRect(key.rect, keys[i + 1].rect),
  );
}
