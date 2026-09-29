import { clamp } from "./easing.js";
import { evalCursor } from "./cursor.js";
import type { Viewport } from "./camera.js";
import type { CursorTrack, Vec2 } from "./timeline.js";

/**
 * A camera that follows the cursor.
 *
 * The framing at each frame is a fixed size, `viewport / scale`, centred as
 * near the cursor as three things allow:
 *
 *  1. **A dead zone.** The camera keeps a window centre that moves only when
 *     the cursor pushes past the window's edge, the way a platform game's
 *     camera follows its character. A cursor moving to the next field of a
 *     form stays inside the window, so the camera does not answer it: a
 *     camera that answered every movement would be the zooming in and out
 *     this mode exists to stop, only smaller.
 *  2. **The page.** The window centre is clamped so the frame never leaves
 *     the captured viewport, which has nothing beyond its edge to show.
 *  3. **A critically damped spring, run forward and then backward** over the
 *     window's path.
 *
 * Why a spring run both ways, rather than once: a spring that only runs
 * forward trails its target by twice its time constant times the target's
 * speed. At 1.35× on a 1440-wide page, a spring soft enough to look smooth
 * trailed a cursor crossing the page by enough to put the cursor at the
 * frame's edge, and past it. The recording knows the whole cursor path
 * before anything is drawn, so the camera may use the path's future as well
 * as its past, and run backward the spring's lag cancels its own lag. What it
 * costs is a little anticipation: the camera sets off a moment before the
 * cursor does, which is what a camera operator who knew the script would do.
 *
 * The spring's impulse response is never negative, and neither is the
 * reversed one, so every camera position is a weighted average of window
 * positions. Three properties follow from that alone, with no clamping
 * afterwards to break them: the camera never overshoots, because it never
 * goes beyond where the window has been; it stays inside the page, because
 * an average of positions inside an interval is inside it; and it moves
 * smoothly, because a critically damped spring's velocity and acceleration
 * are continuous however sharply its target turns.
 */

export type FollowSpec = {
  /** Magnification, exactly: the frame is `viewport / scale` the whole time. */
  scale: number;
  /**
   * The share of the frame, around its centre, the cursor can move within
   * without moving the camera: `0.3` is a box 30% of the frame's width by
   * 30% of its height.
   */
  deadZone: number;
  /**
   * How long the camera takes over a move the cursor made at once, from 3%
   * to 97% of the way, in milliseconds. That span is eight of the spring's
   * time constants, so this is eight times the time constant.
   */
  smoothingMs: number;
};

/** Time constants in `smoothingMs`: the span of a jump's response, 3% to 97%. */
const TIME_CONSTANTS_PER_SMOOTHING = 8;

/**
 * Time constants of input held still before the backward pass starts.
 *
 * The backward pass has to start from rest, and a spring coming to rest never
 * quite arrives: after thirty time constants the remainder is under a
 * billionth of the distance it had to go, which on any page is far below a
 * thousandth of a pixel.
 */
const SETTLED_AFTER = 30;

/**
 * One step of a critically damped spring, `y'' + 2ωy' + ω²y = ω²u`, from
 * position `y` and velocity `v`, with the target held at `u` for `dt`.
 *
 * Exact for a target held still over the step, rather than an Euler step's
 * approximation, so the path depends on the frame rate only through where the
 * cursor is sampled: a draft at 15 frames a second follows the same curve as
 * a recording at 60.
 */
export function springStep(
  y: number,
  v: number,
  u: number,
  omega: number,
  dt: number,
): [number, number] {
  const e = y - u;
  const k = v + omega * e;
  const decay = Math.exp(-omega * dt);
  return [u + (e + k * dt) * decay, (v - omega * k * dt) * decay];
}

/** A spring over a whole sequence, starting at rest on its first value. */
function spring(input: readonly number[], omega: number, dt: number): number[] {
  const out = new Array<number>(input.length);
  let y = input[0];
  let v = 0;
  for (let i = 0; i < input.length; i += 1) {
    if (i > 0) [y, v] = springStep(y, v, input[i], omega, dt);
    out[i] = y;
  }
  return out;
}

/**
 * A spring run forward and then backward: the same curve with no lag.
 *
 * Holding each sample over the step that ends on it leads the input by half
 * a step on the way forward, and the backward pass trails it by the same
 * half step, so the two cancel as well.
 */
export function zeroPhaseSpring(
  input: readonly number[],
  omega: number,
  dt: number,
): number[] {
  if (input.length === 0) return [];
  const forward = spring(input, omega, dt);
  return spring(forward.reverse(), omega, dt).reverse();
}

export type FollowPathInput = {
  cursor: CursorTrack;
  /** Where the cursor is when the track is empty: its resting place in frame 0. */
  cursorStart: Vec2;
  viewport: Viewport;
  fps: number;
  spec: FollowSpec;
  /** The first frame the follow is asked for: the first at or after its write. */
  firstFrame: number;
  /** The last frame anything will ask for. */
  lastFrame: number;
  /**
   * When the follow stops reading the cursor, in seconds: the next camera
   * write. From then on it treats the cursor as still where it was, so the
   * camera comes to rest on the framing it was heading for instead of
   * chasing a cursor the clip has stopped following.
   */
  until: number;
};

/**
 * The centre of the follow's frame at every frame from `firstFrame` to
 * `lastFrame`, in viewport pixels. The frame itself is `viewport / scale`,
 * centred there.
 *
 * A pure function of its input: the same cursor track and the same numbers
 * make the same path, to the bit, which is what lets a recording that follows
 * the cursor be compared byte for byte with the next one.
 */
export function followCentres(input: FollowPathInput): Vec2[] {
  const { viewport, fps, spec, firstFrame, lastFrame } = input;
  if (lastFrame < firstFrame) return [];
  if (!(spec.smoothingMs > 0)) {
    throw new RangeError(
      `A follow's smoothing has to be more than 0ms, not ${spec.smoothingMs}.`,
    );
  }

  const frameW = viewport.width / spec.scale;
  const frameH = viewport.height / spec.scale;
  // Half the dead zone each side of the window's centre.
  const slackX = (spec.deadZone * frameW) / 2;
  const slackY = (spec.deadZone * frameH) / 2;
  const dt = 1 / fps;
  const timeConstant = spec.smoothingMs / 1000 / TIME_CONSTANTS_PER_SMOOTHING;
  const omega = 1 / timeConstant;

  const cursorAt = (t: number): Vec2 =>
    input.cursor.length === 0
      ? input.cursorStart
      : evalCursor(input.cursor, Math.min(t, input.until));

  // Past the last frame anything asks for, the path goes on until the window
  // has been still for long enough that the backward pass can start from
  // rest. The window is still once the cursor is: after the follow stops
  // reading it, or after the track's last step, whichever is first.
  const trackEnd =
    input.cursor.length === 0 ? 0 : input.cursor[input.cursor.length - 1].t1;
  const stillFrom = Math.ceil(Math.min(input.until, trackEnd) * fps);
  const farFrame =
    Math.max(lastFrame, stillFrom) +
    Math.ceil(SETTLED_AFTER * timeConstant * fps);

  const windowX: number[] = [];
  const windowY: number[] = [];
  let x = 0;
  let y = 0;
  for (let frame = firstFrame; frame <= farFrame; frame += 1) {
    const [px, py] = cursorAt(frame / fps);
    if (frame === firstFrame) {
      // A follow starts centred on the cursor, as near as the page allows.
      // The dead zone is for what the cursor does next; starting at its edge
      // would frame the cursor off-centre for no reason anyone could see.
      x = px;
      y = py;
    } else {
      x = clamp(x, px - slackX, px + slackX);
      y = clamp(y, py - slackY, py + slackY);
    }
    x = clamp(x, frameW / 2, viewport.width - frameW / 2);
    y = clamp(y, frameH / 2, viewport.height - frameH / 2);
    windowX.push(x);
    windowY.push(y);
  }

  const smoothX = zeroPhaseSpring(windowX, omega, dt);
  const smoothY = zeroPhaseSpring(windowY, omega, dt);
  const centres: Vec2[] = [];
  for (let i = 0; i <= lastFrame - firstFrame; i += 1) {
    centres.push([smoothX[i], smoothY[i]]);
  }
  return centres;
}

export type FollowOptions = {
  /** Magnification, exactly. */
  scale?: number;
  /** The share of the frame the cursor can move within without moving the camera. */
  deadZone?: number;
  /** How softly the camera follows, in milliseconds. */
  smoothing?: number;
  /** How long the camera takes to get from where it was into the follow. */
  duration?: number;
};

export type FollowDefaults = {
  followZoom: number;
  followDeadZone: number;
  followSmoothingMs: number;
  zoomDurationMs: number;
};

/**
 * A follow's options, with the config's defaults filled in and each one
 * checked where the clip wrote it.
 *
 * Checked here rather than when the path is computed, because by then the
 * clip has run to the end: a scale of 0.8 found in `finish()` would fail the
 * recording without naming the line that asked for it.
 */
export function resolveFollow(
  options: FollowOptions,
  defaults: FollowDefaults,
): { spec: FollowSpec; durationMs: number } {
  const scale = options.scale ?? defaults.followZoom;
  const deadZone = options.deadZone ?? defaults.followDeadZone;
  const smoothingMs = options.smoothing ?? defaults.followSmoothingMs;
  const durationMs = options.duration ?? defaults.zoomDurationMs;

  if (!Number.isFinite(scale) || scale < 1) {
    throw new RangeError(
      `camera.follow: scale is ${scale}. It is a magnification, at least 1: ` +
        "1.35 shows the page at 1.35 times its size.",
    );
  }
  if (!Number.isFinite(deadZone) || deadZone < 0 || deadZone >= 1) {
    throw new RangeError(
      `camera.follow: deadZone is ${deadZone}. It is a share of the frame, ` +
        "from 0 (answer every movement) to below 1: 0.3 lets the cursor " +
        "move across the middle 30% without moving the camera.",
    );
  }
  if (!Number.isFinite(smoothingMs) || smoothingMs <= 0) {
    throw new RangeError(
      `camera.follow: smoothing is ${smoothingMs}. It is in milliseconds, ` +
        "and more than 0: larger follows more softly.",
    );
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError(
      `camera.follow: duration is ${durationMs}. It is in milliseconds, ` +
        "0 or more: 0 cuts straight into the follow.",
    );
  }
  return { spec: { scale, deadZone, smoothingMs }, durationMs };
}
