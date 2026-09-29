import type { Locator, Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  cursorEnd,
  evalCursor,
  planMove,
  targetPoint,
} from "../core/cursor.js";
import { zoomRect } from "../core/camera.js";
import { cameraTrack } from "../core/camera-track.js";
import type { CameraWrite } from "../core/camera-track.js";
import { resolveFollow } from "../core/follow.js";
import type { FollowOptions } from "../core/follow.js";
import { loop as planLoop, resampleByArcLength } from "../core/loop.js";
import type { LoopPlanner } from "../core/loop.js";
import { seeded } from "../core/rng.js";
import { typingSchedule } from "../core/typing.js";
import {
  emptyTimeline,
  frameAt,
  timeAt,
  validateTimeline,
} from "../core/timeline.js";
import type { HighlightStyle, Rect, Timeline, Vec2 } from "../core/timeline.js";
import { emptyTiming } from "../core/timing.js";
import type { RecordingTiming } from "../core/timing.js";
import { TICK_MS, settlePage } from "./settle.js";
import type { SettleOptions, SettleReport } from "./settle.js";
import { FRAME_PROBE } from "./page-hooks.js";
import type { FrameProbe } from "./page-hooks.js";
import type { CaptureConfig, ResolvedConfig } from "../config.js";

export type SessionOptions = {
  clipId: string;
  title: string;
  /** Resolved for this clip: the config's values with the clip's overrides. */
  fps: number;
  viewport: { width: number; height: number };
  dpr: number;
  seed: number;
  outputDir: string;
  appCommit: string;
  /** The versioncam version making the recording, for its provenance. */
  recorder: string;
  capture: Required<CaptureConfig>;
  /**
   * Capture at CSS scale rather than device scale, for a cheap look at a clip
   * while writing it. The page is not told: same viewport, same device pixel
   * ratio, same layout, same code paths — only the screenshot is smaller.
   */
  draft: boolean;
  config: ResolvedConfig;
};

type ScheduledAction = { t: number; run: () => Promise<void> };

/** Members a script calls that are not steps: locator factories, and the driver's own. */
const NOT_A_STEP =
  /^(by[A-Z]|css$|constructor$|finish$|forClipBody$|evidence$)/;

/**
 * `Array.isArray` does not narrow a readonly tuple union, and a Locator is an
 * object like any other, so both targets need real guards.
 *
 * A point is `[x, y]`. An `{ x, y }` object looks like one — it is what a
 * bounding box or a measured rect hands you — and used to be taken for a
 * locator, failing deep in Playwright with "locator.count is not a function",
 * which names neither the step nor the fix. It is refused here instead.
 */
function isPoint(target: Locator | Vec2): target is Vec2 {
  if (Array.isArray(target)) return true;
  const t = target as unknown as Record<string, unknown>;
  if (
    typeof t.count !== "function" &&
    typeof t.x === "number" &&
    typeof t.y === "number"
  ) {
    throw new TypeError(
      `A point is [x, y], not { x, y }: write [${t.x}, ${t.y}].`,
    );
  }
  return false;
}

function isRect(target: Locator | Rect): target is Rect {
  return (
    typeof target === "object" &&
    target !== null &&
    "x" in target &&
    "w" in target
  );
}

/**
 * Drives the app through an authored timeline and captures one image per
 * output frame.
 *
 * The central idea: the clip's time is declared by the script, not measured
 * from the wall clock. Each frame we apply that frame's input, advance the
 * page's fake clock by exactly 1/fps, and capture. Real latency — a DuckDB
 * query, a tile fetch, WebGL under software rendering — is absorbed by
 * `settle()`, which advances the clock without capturing. Two runs of the
 * same script therefore produce the same frames on any machine.
 */
export class RecordingSession {
  readonly page: Page;

  private readonly options: SessionOptions;
  private readonly timeline: Timeline;
  private readonly rng: () => number;
  private readonly motion: ResolvedConfig["motion"];
  private readonly statesDir: string;
  private readonly stateIndexByHash = new Map<string, number>();
  private readonly queue: ScheduledAction[] = [];
  private readonly settleReports: SettleReport[] = [];
  /**
   * What the clip asked of the camera, turned into keys by `finish()`. Not
   * keys as it goes, because a camera following the cursor depends on where
   * the cursor goes next, which only the rest of the clip says.
   */
  private readonly cameraWrites: CameraWrite[] = [];
  /** The first box each step measured, by the step's index. */
  private readonly stepTargets: Record<string, Rect> = {};
  /** Where the cursor rests in frame 0, before its track has a step. */
  private readonly cursorStart: Vec2;

  /** Authored time, in seconds. */
  private t = 0;
  /** Index of the last captured frame; -1 before frame 0 exists. */
  private frame = -1;
  private cursor: Vec2;
  private inFlight = 0;
  private lastSettleFrame = -1;
  private readonly timing = emptyTiming();
  /**
   * Where the real mouse actually is. The planned cursor holds still for most
   * of a clip, and telling Chromium to move a pointer to where it already is
   * costs 8 ms and achieves nothing.
   */
  private lastMouse: Vec2 | null = null;
  /** What the page looked like to the probe when it was last photographed. */
  private lastCaptured: FrameProbe | null = null;
  private lastCapturedFrame = -1;
  /**
   * Set whenever the driver sends the page real input, and cleared by the next
   * frame's capture decision.
   *
   * Input can change what the page looks like without changing anything the
   * probe watches: `:active` while a button is held is pure CSS, driven by a
   * pointer event, touching neither the DOM nor the element under the cursor.
   * The gate would skip those frames and the clip would show a button that is
   * never pressed.
   */
  private inputPending = false;

  constructor(page: Page, options: SessionOptions) {
    this.page = page;
    this.options = options;
    this.rng = seeded(options.seed);
    this.motion = options.config.motion;
    this.statesDir = join(options.outputDir, "states");
    // Where frame 0 finds the pointer. Parking it on a control means the clip
    // opens with that control's tooltip already up, or its focus ring showing —
    // which a reviewer will fail, and has, on two different apps. There is no
    // default that suits every layout, so `cursorStart` is a config field and
    // this is only its fallback.
    const start = options.config.cursorStart;
    this.cursor = [
      options.viewport.width * start.x,
      options.viewport.height * start.y,
    ];
    this.cursorStart = this.cursor;

    this.timeline = emptyTimeline({
      clipId: options.clipId,
      fps: options.fps,
      // A draft's state images are CSS-sized, and `dpr` is how the renderer
      // maps viewport coordinates onto pixels inside them.
      viewport: { ...options.viewport, dpr: options.draft ? 1 : options.dpr },
      title: options.title,
      appCommit: options.appCommit,
      baseUrl: options.config.baseUrl,
      // Fixed, so two recordings of the same script differ in no byte at all.
      recordedAt: "1970-01-01T00:00:00.000Z",
      recorder: options.recorder,
    });

    page.on("request", () => {
      this.inFlight += 1;
    });
    page.on("requestfinished", () => {
      this.inFlight = Math.max(0, this.inFlight - 1);
    });
    page.on("requestfailed", () => {
      this.inFlight = Math.max(0, this.inFlight - 1);
    });

    rmSync(options.outputDir, { recursive: true, force: true });
    mkdirSync(this.statesDir, { recursive: true });
  }

  // ── locators ──────────────────────────────────────────────────────────────

  byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  byRole(
    role: Parameters<Page["getByRole"]>[0],
    options?: Parameters<Page["getByRole"]>[1],
  ): Locator {
    return this.page.getByRole(role, options);
  }

  byLabel(text: string): Locator {
    return this.page.getByLabel(text);
  }

  byPlaceholder(text: string): Locator {
    return this.page.getByPlaceholder(text);
  }

  byText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  css(selector: string): Locator {
    return this.page.locator(selector);
  }

  // ── time ──────────────────────────────────────────────────────────────────

  /** Hold still for `ms`, capturing frames. */
  async hold(ms: number): Promise<void> {
    const until = this.t + ms / 1000;
    this.pushHold(until);
    await this.advanceTo(until);
  }

  /**
   * Run raw Playwright without capturing or advancing authored time. For
   * setup that should not appear in the clip: seeding cohorts, warming tiles,
   * priming a chat conversation.
   *
   * The page's clock does not move either, however long `fn` takes: time the
   * app needs to finish what `fn` started is what the next `settle()` is for.
   */
  async offCamera<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    return fn(this.page);
  }

  /**
   * Wait for the page to stop working. Advances the page's clock but captures
   * nothing, so the wait never reaches the timeline.
   */
  async settle(options: SettleOptions = {}): Promise<void> {
    const defaults = this.options.config.settle;
    const startedAt = performance.now();
    const report = await settlePage(this.page, () => this.inFlight, {
      quietMs: defaults.quietMs,
      timeoutMs: defaults.timeoutMs,
      yieldMs: defaults.yieldMs,
      ...options,
      hook: options.hook ?? this.defaultHook(),
    });
    this.timing.settleMs += performance.now() - startedAt;
    this.settleReports.push(report);
    if (report.elapsedMs > 1000) {
      console.log(
        `[recorder] ${report.label} took ${report.elapsedMs}ms (last blocker: ${report.lastBlocker})`,
      );
    }
    // A labelled settle is a beat, and the beat is worth finding again: by
    // frame, for the sheet and for review. The frame after this one, because
    // a settle captures nothing and the first picture of what it waited for is
    // the next frame — which for `open()`, settling before any frame exists,
    // is frame 0.
    if (options.label) {
      this.timeline.marks.push({ frame: this.frame + 1, label: options.label });
    }
    // The next captured frame may differ wholesale from the last one; tell the
    // renderer it may crossfade here instead of cutting hard.
    if (this.frame >= 0 && this.frame !== this.lastSettleFrame) {
      this.timeline.cuts.push(this.frame);
      this.lastSettleFrame = this.frame;
    }
  }

  private defaultHook(): (() => Promise<boolean>) | undefined {
    const ready = this.options.config.settle.ready;
    if (!ready) return undefined;
    return () => ready(this.page);
  }

  // ── navigation ────────────────────────────────────────────────────────────

  /**
   * Open a path, sign in if the app needs it, wait for the page to be
   * genuinely finished, and capture frame 0.
   *
   * Signing in is the app's own business: how it knows it is signed out, which
   * fields, which button, what counts as done. The config supplies either a
   * saved browser session — in which case there is nothing to do here — or a
   * hook, which is called unconditionally after the navigation and decides for
   * itself whether anything is needed.
   */
  async open(
    path: string,
    options: { settleTimeoutMs?: number } = {},
  ): Promise<void> {
    const url = path.startsWith("http")
      ? path
      : `${this.options.config.baseUrl}${path}`;
    const startedAt = performance.now();
    await this.page.goto(url, { waitUntil: "domcontentloaded" });

    // Signing in is the one stretch where the page is in someone else's hands
    // and the recorder cannot know what the app is waiting for — a redirect
    // on a timer, a debounced field — so the page's clock runs alongside real
    // time for it, as it would in any browser. Nothing is filmed until the
    // settle below has had its say.
    const auth = this.options.config.auth;
    const login = auth?.login;
    if (login) await this.whileTicking(() => login(this.page));
    this.timing.openMs += performance.now() - startedAt;

    await this.settle({
      label: `open ${path}`,
      timeoutMs: options.settleTimeoutMs ?? 90_000,
    });

    const framesAt = performance.now();
    await this.moveMouse(this.cursor);
    await this.captureFrame(
      0,
      await this.page.evaluate<FrameProbe>(
        FRAME_PROBE(0, this.cursor[0], this.cursor[1]),
      ),
    );
    this.timing.framesMs += performance.now() - framesAt;
    this.frame = 0;
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  /** Glide to a target without pressing anything. */
  async moveTo(
    target: Locator | Vec2,
    options: { duration?: number } = {},
  ): Promise<void> {
    const point = await this.resolvePoint(target);
    const size = await this.resolveSize(target);
    const segment = planMove(this.cursor, point, this.t, this.rng, {
      targetSize: size,
      duration: options.duration,
    });
    this.timeline.cursor.push(segment);
    await this.advanceTo(segment.t1);
    this.cursor = point;
  }

  /** Move to a target and pause on it, the way a person does before clicking. */
  async hover(
    target: Locator | Vec2,
    options: { dwell?: number; duration?: number } = {},
  ): Promise<void> {
    await this.moveTo(target, { duration: options.duration });
    await this.hold(options.dwell ?? this.motion.hoverDwellMs);
  }

  /**
   * A full click: approach, a short dwell on the target, press, release.
   *
   * Implemented on `page.mouse` rather than `locator.click()`, which would
   * teleport the pointer to the element — the approach *is* the thing being
   * recorded.
   */
  async click(
    target?: Locator | Vec2,
    options: { dwell?: number } = {},
  ): Promise<void> {
    if (target) await this.moveTo(target);
    const dwell =
      options.dwell ??
      this.motion.clickDwellMinMs +
        this.rng() *
          (this.motion.clickDwellMaxMs - this.motion.clickDwellMinMs);
    this.pushHold(this.t + dwell / 1000);
    await this.advanceTo(this.t + dwell / 1000);

    await this.pressMouse("down");

    const pressMs =
      this.motion.pressMinMs +
      this.rng() * (this.motion.pressMaxMs - this.motion.pressMinMs);
    this.pushHold(this.t + pressMs / 1000);
    await this.advanceTo(this.t + pressMs / 1000);

    await this.pressMouse("up");
  }

  /**
   * Draw a lasso: press, follow a smoothed closed loop at constant speed,
   * release. `planner` comes from `loop([...])` and is expressed in fractions
   * of the target's box, so the stroke survives a layout change.
   */
  /**
   * Drag across a target, in fractions of its own box.
   *
   * A brush, a slider, a range handle: controls that respond to a stroke and
   * ignore a click. The README promised this method for months before it
   * existed, and the gap was not academic — a date-histogram clip on the
   * first app this recorded clicked a bar to filter by month, which sets a
   * zero-width d3 brush, which *clears* the filter rather than applying one.
   * That clip never showed the thing its caption claimed, and nothing said
   * so: the click lands, the page changes enough for a pixel diff, and the
   * recording looks fine.
   *
   * Fractions rather than pixels for the same reason `lasso` uses them: a
   * stroke authored against a real box survives the next padding change.
   * `{ x1: 0.18, y1: 0.5, x2: 0.36, y2: 0.5 }` drags left-to-right across the
   * middle. Beware the edges — a chart's axis labels live inside its own box,
   * and a drag starting at x 0.08 selects that text instead of the control.
   */
  async drag(
    target: Locator | Rect,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options: { duration?: number; modifiers?: ("Shift" | "Alt")[] } = {},
  ): Promise<void> {
    const box = isRect(target) ? target : await this.boxOf(target);
    const at = (f: { x: number; y: number }): Vec2 => [
      box.x + box.w * f.x,
      box.y + box.h * f.y,
    ];
    const start = at(from);
    const end = at(to);

    const durationMs = options.duration ?? this.motion.lassoDurationMs;
    const frames = Math.max(
      2,
      Math.round((durationMs / 1000) * this.options.fps),
    );

    await this.moveTo(start);
    await this.hold(this.motion.hoverDwellMs);

    for (const modifier of options.modifiers ?? []) {
      await this.page.keyboard.down(modifier);
    }

    await this.pressMouse("down");

    // One authored point per frame, as `lasso` does: the stroke advances at
    // exactly the rate the video plays, so the app is never asked to keep up
    // with a drag that outruns its own rendering.
    const frameSeconds = 1 / this.options.fps;
    for (let step = 1; step <= frames; step += 1) {
      const u = step / frames;
      const point: Vec2 = [
        start[0] + (end[0] - start[0]) * u,
        start[1] + (end[1] - start[1]) * u,
      ];
      const previous = this.cursor;
      this.timeline.cursor.push({
        kind: "move",
        t0: this.t,
        t1: this.t + frameSeconds,
        from: previous,
        to: point,
        ctrl: [(previous[0] + point[0]) / 2, (previous[1] + point[1]) / 2],
        ease: "minjerk",
      });
      this.cursor = point;
      await this.advanceTo(this.t + frameSeconds);
    }

    await this.pressMouse("up");

    for (const modifier of options.modifiers ?? []) {
      await this.page.keyboard.up(modifier);
    }
  }

  async lasso(
    target: Locator,
    planner: LoopPlanner,
    options: { duration?: number; modifiers?: ("Shift" | "Alt")[] } = {},
  ): Promise<void> {
    const box = await this.boxOf(target);
    const path = planner(box, this.rng);
    const durationMs = options.duration ?? this.motion.lassoDurationMs;
    const frames = Math.max(
      2,
      Math.round((durationMs / 1000) * this.options.fps),
    );
    const points = resampleByArcLength(path, frames);

    await this.moveTo(points[0]);
    await this.hold(this.motion.hoverDwellMs);

    for (const modifier of options.modifiers ?? []) {
      await this.page.keyboard.down(modifier);
    }

    await this.pressMouse("down");

    // One authored point per frame: the stroke advances exactly as fast as the
    // video does, so it can never outrun what the map has drawn.
    const frameSeconds = 1 / this.options.fps;
    for (const point of points.slice(1)) {
      const from = this.cursor;
      this.timeline.cursor.push({
        kind: "move",
        t0: this.t,
        t1: this.t + frameSeconds,
        from,
        to: point,
        ctrl: [(from[0] + point[0]) / 2, (from[1] + point[1]) / 2],
        ease: "minjerk",
      });
      this.cursor = point;
      await this.advanceTo(this.t + frameSeconds);
    }

    await this.pressMouse("up");

    for (const modifier of options.modifiers ?? []) {
      await this.page.keyboard.up(modifier);
    }
  }

  // ── keyboard ──────────────────────────────────────────────────────────────

  /**
   * Type at a human cadence into `target`, clicking it first so the keystrokes
   * have somewhere to land. Without the click the text goes to whatever had
   * focus — usually nothing — and the clip shows an empty field being
   * "typed" into.
   */
  async typeInto(target: Locator, text: string): Promise<void> {
    await this.click(target);
    await this.type(text);
  }

  /** Type at a human cadence. The cursor stays where it is. */
  async type(text: string): Promise<void> {
    const schedule = typingSchedule(text, this.rng);
    const start = this.t;
    for (const [index, char] of [...text].entries()) {
      this.queue.push({
        t: start + schedule[index] / 1000,
        run: async () => {
          await this.page.keyboard.type(char);
          this.inputPending = true;
        },
      });
    }
    const until = start + schedule[schedule.length - 1] / 1000;
    this.pushHold(until);
    await this.advanceTo(until);
    // The last keystroke is due at `until`, and `advanceTo` stops at the frame
    // nearest it — the one before, whenever `until` falls short of the
    // midpoint. Left queued, that keystroke ran after whatever the clip did
    // next: an Enter pressed straight after typing sent the text without its
    // last character, which then began the next message.
    while (this.queue.length > 0 && this.queue[0].t <= until) {
      const keystroke = this.queue.shift();
      if (keystroke) await keystroke.run();
    }
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    this.inputPending = true;
  }

  // ── camera, highlight, caption ────────────────────────────────────────────

  /**
   * Each of these starts from wherever the camera is, still or moving, and
   * blends into where it is going over its `duration`: see `cameraTrack`.
   */
  readonly camera = {
    zoom: async (
      target: Locator | Rect,
      scale?: number,
      options: { duration?: number } = {},
    ): Promise<void> => {
      const box = isRect(target) ? target : await this.boxOf(target);
      const rect = zoomRect(box, this.options.viewport, {
        maxScale: scale ?? this.motion.defaultZoom,
        pad: this.motion.zoomPad,
      });
      this.frameCamera(rect, options.duration);
    },
    to: (rect: Rect, options: { duration?: number } = {}): void => {
      this.frameCamera(rect, options.duration);
    },
    reset: (options: { duration?: number } = {}): void => {
      this.frameCamera(
        {
          x: 0,
          y: 0,
          w: this.options.viewport.width,
          h: this.options.viewport.height,
        },
        options.duration,
      );
    },
    /**
     * Follow the cursor at one scale until the next camera write, keeping it
     * inside a dead zone around the frame's centre and the frame inside the
     * page. The options are checked here, so a bad one fails this line.
     */
    follow: (options: FollowOptions = {}): void => {
      const { spec, durationMs } = resolveFollow(options, this.motion);
      this.cameraWrites.push({ t: this.t, kind: "follow", spec, durationMs });
    },
    /** Stop following, and come to rest on the framing the follow was heading for. */
    release: (): void => {
      this.cameraWrites.push({ t: this.t, kind: "release" });
    },
  };

  private frameCamera(rect: Rect, durationMs?: number): void {
    this.cameraWrites.push({
      t: this.t,
      kind: "frame",
      rect,
      durationMs: durationMs ?? this.motion.zoomDurationMs,
    });
  }

  async highlight(
    target: Locator | Rect,
    style: HighlightStyle,
    options: { for?: number } = {},
  ): Promise<void> {
    const rect = isRect(target) ? target : await this.boxOf(target);
    this.timeline.highlights.push({
      t0: this.t,
      t1: this.t + (options.for ?? this.motion.highlightMs) / 1000,
      rect,
      style,
    });
  }

  /**
   * Put a line of text on the clip, from now until the next caption or the end.
   *
   * `from` defaults to the moment it is written, not to zero. Defaulting to
   * zero meant a second caption covered the whole clip on top of the first, so
   * every frame carried both lines drawn over each other — which reads on a
   * contact sheet as ghosted text rather than as a caption bug, and cost a
   * pilot most of a round to diagnose.
   */
  caption(text: string, options: { from?: number; to?: number } = {}): void {
    const t0 = options.from ?? this.t;
    const previous = this.timeline.captions[this.timeline.captions.length - 1];
    // A caption stays up until something replaces it, so writing the next one
    // is what ends the last one. `max` keeps the range well formed when a
    // caption was given an explicit `from` later than this one's.
    if (previous && previous.t1 > t0) {
      previous.t1 = Math.max(previous.t0, t0);
    }
    this.timeline.captions.push({
      t0,
      t1: options.to ?? Number.POSITIVE_INFINITY,
      text,
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private pushHold(until: number): void {
    if (until <= this.t) return;
    this.timeline.cursor.push({
      kind: "hold",
      t0: this.t,
      t1: until,
      at: this.cursor,
    });
  }

  /**
   * Bounded on purpose. `boundingBox()` waits indefinitely by default, so a
   * clip that reaches for a control the app did not render — a button that
   * only appears once something is selected, say — hangs forever with no clue
   * as to which step it was on. Fifteen seconds and a named failure instead.
   */
  private async boxOf(locator: Locator, timeoutMs = 15_000): Promise<Rect> {
    if (!(await this.untilVisible(locator, timeoutMs))) {
      throw new Error(await this.whyLocatorFailed(locator, timeoutMs));
    }
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error(
        `Matched ${locator.toString()} but it has no box (zero-sized or detached).`,
      );
    }
    const rect = { x: box.x, y: box.y, w: box.width, h: box.height };
    // Kept for the targets sidecar: the first box a step measures is the
    // control it acts on. A step's own later measurements (typeInto clicking
    // the field it already measured) must not replace it.
    const steps = this.timeline.steps ?? [];
    if (steps.length > 0) this.stepTargets[String(steps.length - 1)] ??= rect;
    return rect;
  }

  /**
   * Wait for a target to be on screen, advancing the page's clock a tick at a
   * time while it is not.
   *
   * The clock is paused, so a target the app shows from its own timer — a menu
   * that opens after a delay, results behind a debounce — would never arrive
   * if this only waited. Ticking as `settle()` does brings it in the same
   * number of ticks every run, and costs nothing in the usual case: a target
   * already on screen is one round trip and no page time at all.
   */
  private async untilVisible(
    locator: Locator,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      try {
        if (await locator.isVisible()) return true;
      } catch {
        // Almost always a locator that matched more than one element, which
        // no amount of waiting fixes; the caller says which failure it was.
        return false;
      }
      if (performance.now() > deadline) return false;
      await this.page.clock.runFor(TICK_MS);
      await sleep(TICK_MS);
    }
  }

  /**
   * Run `fn` with the page's clock ticking alongside real time, the way it
   * runs in a browser nobody is driving.
   *
   * Only for code the recorder hands the page to and cannot see into, and
   * never while a frame is being made: the ticks land wherever the machine's
   * speed puts them, which is exactly what the frames must not depend on.
   */
  private async whileTicking<T>(fn: () => Promise<T>): Promise<T> {
    let done = false;
    const ticking = (async () => {
      while (!done) {
        await sleep(TICK_MS);
        if (done) break;
        // One of the app's timers throwing is the app's business, as it
        // would be in any browser, and not a reason to fail the sign-in it
        // happened during.
        await this.page.clock.runFor(TICK_MS).catch(() => undefined);
      }
    })();
    try {
      return await fn();
    } finally {
      done = true;
      await ticking;
    }
  }

  /**
   * Which kind of locator failure this was.
   *
   * Playwright reports both of them as a rejected wait, and they call for
   * opposite repairs. Nothing matched means the clip reached for something the
   * app never rendered — look at the page again. Several matched is a
   * strict-mode violation: the locator found the text, on more than one
   * element, and the beat is fine as long as the locator names one of them.
   * Saying "nothing matched" for the second sent a pilot hunting a control
   * that was on screen the whole time.
   */
  private async whyLocatorFailed(
    locator: Locator,
    timeoutMs: number,
  ): Promise<string> {
    const when = `at t=${this.t.toFixed(2)}s (frame ${this.frame})`;
    // The count is a second round trip to a page that has just failed one, so
    // a locator that cannot even be counted falls back to the simpler report.
    const count = await locator.count().catch(() => 0);
    if (count > 1) {
      return (
        `Matched ${count} elements with ${locator.toString()} ${when}. ` +
        "A locator has to resolve to one: use `byRole` with a name, or a test id."
      );
    }
    return (
      `Nothing matched ${locator.toString()} within ${timeoutMs}ms ${when}. ` +
      "The clip expected it to be on screen by this point."
    );
  }

  private async resolvePoint(target: Locator | Vec2): Promise<Vec2> {
    if (isPoint(target)) return target;
    const box = await this.boxOf(target);
    return targetPoint(box, this.rng);
  }

  private async resolveSize(target: Locator | Vec2): Promise<number> {
    if (isPoint(target)) return 24;
    const box = await this.boxOf(target);
    return Math.min(box.w, box.h);
  }

  /**
   * The frame loop. Everything that advances authored time comes through here.
   */
  private async advanceTo(t1: number): Promise<void> {
    const endFrame = frameAt(t1, this.options.fps);
    const frameMs = 1000 / this.options.fps;
    const startedAt = performance.now();

    for (let f = this.frame + 1; f <= endFrame; f += 1) {
      const tf = timeAt(f, this.options.fps);

      const position = evalCursor(this.timeline.cursor, tf);
      await this.moveMouse(position);

      while (this.queue.length > 0 && this.queue[0].t <= tf) {
        const action = this.queue.shift();
        if (action) await action.run();
      }

      await this.page.clock.runFor(frameMs);

      // One round trip, after the input and the tick, because that is the
      // state this frame will be photographed in. It scrubs the page's own CSS
      // animations to this frame's authored time — so a spinner spins at the
      // rate the clip plays rather than the rate the machine ran — and reads
      // back what decides whether this frame needs a screenshot.
      const probe = await this.page.evaluate<FrameProbe>(
        FRAME_PROBE(tf, position[0], position[1]),
      );

      if (this.shouldCapture(f, probe)) {
        await this.captureFrame(f, probe);
      } else {
        this.timeline.frames[f] = this.timeline.frames[f - 1];
        this.timing.skipped += 1;
      }
      this.frame = f;
    }

    this.timing.framesMs += performance.now() - startedAt;
    this.t = t1;
    this.cursor = cursorEnd(this.timeline.cursor, this.cursor);
  }

  /**
   * Does this frame need its own screenshot?
   *
   * Every clause errs towards capturing, because the two mistakes are not
   * equal: capturing a frame that did not change wastes 25 ms, and skipping
   * one that did puts a wrong picture in the video.
   */
  private shouldCapture(frame: number, probe: FrameProbe): boolean {
    if (!this.options.capture.gate) return true;
    const last = this.lastCaptured;
    if (!last) return true;
    // Input landed since the last frame. Its effect may never reach the DOM —
    // a press that only changes `:active` styling never does — so do not ask
    // the probe, just capture.
    if (this.inputPending) {
      this.inputPending = false;
      return true;
    }
    if (probe.mutations !== last.mutations) return true;
    // A scrubbed animation repaints every frame while it runs, touching
    // nothing the other clauses watch.
    if (probe.animations > 0 || last.animations > 0) return true;
    // The pointer glyph is drawn in post, so the cursor moving is not a
    // change — the cursor moving onto something else is.
    if (probe.hovered !== last.hovered) return true;
    return (
      frame - this.lastCapturedFrame >= this.options.capture.forceCaptureEvery
    );
  }

  /** Press or release, recording it and flagging the frame as changed. */
  private async pressMouse(kind: "down" | "up"): Promise<void> {
    if (kind === "down") await this.page.mouse.down();
    else await this.page.mouse.up();
    this.timeline.pointer.push({
      t: this.t,
      kind,
      at: this.cursor,
      button: "left",
    });
    this.inputPending = true;
  }

  /** Move the real pointer, unless it is already there. */
  private async moveMouse(to: Vec2): Promise<void> {
    if (
      this.lastMouse &&
      this.lastMouse[0] === to[0] &&
      this.lastMouse[1] === to[1]
    ) {
      return;
    }
    await this.page.mouse.move(to[0], to[1]);
    this.lastMouse = to;
  }

  private async captureFrame(
    frame: number,
    probe: FrameProbe | null = null,
  ): Promise<void> {
    this.timing.captured += 1;
    const buffer = await this.page.screenshot({
      type: "png",
      scale: this.options.draft ? "css" : "device",
      // Not "hide", although the caret must indeed be hidden.
      //
      // Playwright hides it by injecting a style element before the shot and
      // removing it after — two DOM mutations per screenshot. The capture gate
      // decides whether to take a screenshot by asking whether the DOM changed,
      // so with "hide" every capture guarantees the next frame captures too,
      // and the gate can never skip anything. It reads its own footprint.
      //
      // `FREEZE_CSS` already sets `caret-color: transparent` on everything, as
      // part of putting the page's rendering under the recorder's control, so
      // there is nothing left for this option to do.
      caret: "initial",
      // "allow", emphatically, although this is a recorder of still frames.
      //
      // Playwright's "disabled" is built for a screenshot taken at an
      // arbitrary moment: it cancels an infinite animation to its initial
      // state, shoots, and plays it again. That is the right answer when you
      // have no control over animation time — and the wrong one here, because
      // the recorder does have control. `FREEZE_CSS` has already paused every
      // animation and the driver has already scrubbed it to this frame's
      // authored time, so "disabled" throws that away and photographs a
      // spinner at rotation zero on every frame.
      //
      // It cost more than a dead spinner. Cancelling and replaying around each
      // shot raced the scrub, so the same frame of the same clip came out a
      // few pixels different about one run in three — which is what sent us
      // looking here.
      animations: "allow",
    });
    const hash = createHash("sha1").update(buffer).digest("hex");

    let index = this.stateIndexByHash.get(hash);
    if (index === undefined) {
      index = this.timeline.states.length;
      const name = `${String(index).padStart(4, "0")}.png`;
      writeFileSync(join(this.statesDir, name), buffer);
      this.timeline.states.push(name);
      this.stateIndexByHash.set(hash, index);
    }

    this.timeline.frames[frame] = index;
    this.lastCaptured = probe;
    this.lastCapturedFrame = frame;
  }

  /** What this recording cost in real time. Diagnostics, never content. */
  get cost(): RecordingTiming {
    return { ...this.timing };
  }

  /** Every settle that happened, in order: what each waited for, and for how long. */
  get settles(): SettleReport[] {
    return [...this.settleReports];
  }

  /**
   * How far the clip had got. Meaningless as content — it is where a failure
   * happened, which is the first thing a repair needs and the one thing the
   * script cannot be read to find out.
   */
  get at(): { frame: number; t: number } {
    return { frame: this.frame, t: this.t };
  }

  /**
   * The session as the clip's script sees it.
   *
   * Every call the script makes into the DSL is logged as a step, with the
   * frame it began on. The calls the session makes to itself (`typeInto`'s
   * own click) go through `this` rather than through this view, so they log
   * nothing and a step is always a line of the script. Locator factories
   * build arguments rather than doing anything, and are not steps. Called by
   * `runClip`, never by a clip.
   */
  forClipBody(): RecordingSession {
    const steps = (this.timeline.steps ??= []);
    const view = <T extends object>(target: T, prefix: string): T =>
      new Proxy(target, {
        get: (obj, key) => {
          const value: unknown = Reflect.get(obj, key, obj);
          if (typeof key !== "string") return value;
          if (prefix === "" && key === "camera") {
            return view(value as object, "camera.");
          }
          if (typeof value !== "function" || NOT_A_STEP.test(key)) return value;
          return (...args: unknown[]) => {
            steps.push({ frame: this.frame + 1, call: prefix + key });
            return (value as (...a: unknown[]) => unknown).apply(obj, args);
          };
        },
      });
    return view(this, "");
  }

  /**
   * What the run leaves besides its frames: where each step's target was, and
   * the step that is running now (the one that failed, when this is asked
   * after a failure). Called by `runClip`, never by a clip.
   */
  evidence(): {
    targets: Record<string, Rect>;
    step: { index: number; call: string } | null;
  } {
    const steps = this.timeline.steps ?? [];
    const last = steps.at(-1);
    return {
      targets: { ...this.stepTargets },
      step: last ? { index: steps.length - 1, call: last.call } : null,
    };
  }

  /** Write the timeline out. Called by `clip()` once the script has run. */
  finish(): Timeline {
    const startedAt = performance.now();
    this.timeline.durationFrames = this.timeline.frames.length;
    this.timeline.meta.captured = this.timing.captured;
    if (this.options.draft) this.timeline.meta.draft = true;

    // Only now, with the whole cursor track known: a camera that follows the
    // cursor reads ahead of where it is.
    this.timeline.camera = cameraTrack(this.cameraWrites, {
      viewport: this.options.viewport,
      fps: this.options.fps,
      durationFrames: this.timeline.durationFrames,
      cursor: this.timeline.cursor,
      cursorStart: this.cursorStart,
    });

    const finite = this.timeline.durationFrames / this.options.fps;
    for (const caption of this.timeline.captions) {
      if (!Number.isFinite(caption.t1)) caption.t1 = finite;
    }

    // A settle at the very end of a clip has no frame after it. Its mark
    // points at the last frame there is, which is the closest true picture of
    // what it produced — and leaves `review` to notice that the beat ended
    // where the one before it did.
    const lastFrame = Math.max(0, this.timeline.durationFrames - 1);
    for (const mark of this.timeline.marks) {
      if (mark.frame > lastFrame) mark.frame = lastFrame;
    }

    const problems = validateTimeline(this.timeline);
    if (problems.length > 0) {
      throw new Error(
        `Recorded an invalid timeline for ${this.options.clipId}:\n  ${problems.join("\n  ")}`,
      );
    }

    writeFileSync(
      join(this.options.outputDir, "timeline.json"),
      `${JSON.stringify(this.timeline, null, 2)}\n`,
    );
    this.timing.writeMs += performance.now() - startedAt;
    return this.timeline;
  }
}

export { planLoop as loop };
