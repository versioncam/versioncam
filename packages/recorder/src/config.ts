import { isAbsolute, resolve } from "node:path";
import type { Page } from "playwright";
import { MOTION } from "./core/motion-defaults.js";

/**
 * The one place an app describes itself to the recorder.
 *
 * Everything app-specific goes through this object. If the recorder ever needs
 * to know something about an app that this cannot express, the boundary is in
 * the wrong place and the fix is a field here, not a special case inside.
 */

/**
 * `MOTION` is declared `as const` so each constant reads as its own documented
 * value, which also makes its type the literal. Widen it here: an app
 * overriding `zoomDurationMs` should be able to pass 2000, not only 1100.
 */
export type Motion = { -readonly [K in keyof typeof MOTION]: number };

/**
 * The surround: a backdrop, a device frame, padding, where the caption sits.
 *
 * Absent by default, because the product should record the product. It exists
 * for the case where a clip is going on a landing page and wants to look like
 * a product shot rather than a screen capture.
 */
export type Presentation = {
  /** Two stops for a diagonal gradient, or one flat colour. */
  backdrop?: [string, string] | string;
  /** Rounded corners, hairline and drop shadow around the app. */
  frame?: boolean;
  /** Inset as a fraction of the smaller canvas dimension. 0 disables it. */
  padding?: number;
  /** "auto" puts it below the app when padded, and over it when not. */
  caption?: "auto" | "below" | "overlay" | "none";
  /**
   * Where a caption over the app sits: `{ left: n }` or `{ right: n }`,
   * pixels of the video in from that side, which also picks the bottom
   * corner. Default `{ left: 40 }`.
   *
   * An app keeps its own controls in a corner as often as not (an account
   * menu at the foot of a sidebar, a map's legend), and a caption fixed over
   * one hides what a clip may be pointing at. Ignored when the caption sits
   * below the app, where there is nothing of the app to cover.
   */
  captionInset?: CaptionInset;
};

/** One side and a distance from it, as CSS's `left` and `right` say it. */
export type CaptionInset =
  { left: number; right?: never } | { right: number; left?: never };

export type AuthConfig =
  | { storageState: string; login?: never }
  | { login: (page: Page) => Promise<void>; storageState?: never };

export type SettleConfig = {
  /** How long the page must be quiet before it counts as settled. */
  quietMs?: number;
  /** Real-time cap. Exceeding it warns rather than failing the clip. */
  timeoutMs?: number;
  /** Real milliseconds yielded per tick, so the page can actually do work. */
  yieldMs?: number;
  /**
   * Whatever the generic checks cannot see: a WebGL map that has finished its
   * tiles, a stream that has delivered its first frame.
   */
  ready?: (page: Page) => Promise<boolean>;
};

export type CaptureConfig = {
  /**
   * Skip the screenshot when nothing observable changed since the last one.
   * On by default: a clip is mostly frames where nothing moved, and the
   * screenshot is by far the most expensive thing a frame does.
   */
  gate?: boolean;
  /**
   * Capture regardless every N frames, however still the page looks.
   *
   * The gate watches the DOM, the element under the cursor and the running
   * animations, which covers everything a page built from elements can do. It
   * does not cover a canvas, a WebGL view or a video, which redraw themselves
   * without any of those changing. This is the floor under that blind spot:
   * at 60 fps the default catches such a change within half a second. A clip
   * whose subject *is* a canvas should set it to 1 and pay full price.
   */
  forceCaptureEvery?: number;
  /**
   * What the page's CSS transitions do while it is filmed.
   *
   * `"play"`, the default: each one runs at its authored duration and
   * easing, on the page's own clock, from the frame the driver first sees
   * it, so a map that zooms with a transition zooms over its frames instead
   * of jumping. A settle waits for the ones running to finish.
   *
   * `"zero"`: every transition takes no time, so a change lands in the frame
   * after it, and the renderer's crossfade at a settle is all the motion
   * there is. What the recorder did before 0.4.0, for a clip whose app
   * animates in ways better left out of a video.
   */
  transitions?: Transitions;
};

/** See `CaptureConfig.transitions`. */
export type Transitions = "play" | "zero";

/**
 * Checked where a value enters: in the config here, and in a clip's own
 * `capture` by `runClip`, since nothing else checks a clip's options.
 */
export function isTransitions(value: unknown): value is Transitions {
  return value === "play" || value === "zero";
}

function transitionsOf(value: unknown, field: string): Transitions {
  if (value === undefined) return "play";
  if (isTransitions(value)) return value;
  fail(field, `must be "play" or "zero", got ${JSON.stringify(value)}`);
}

export type ReviewConfig = {
  /**
   * How long a clip of this app should run, in seconds.
   *
   * Ten seconds is the shape of a feature clip and the default, but it is a
   * house style rather than a law: an app whose clips are one crisp
   * interaction each should say five, and an app demonstrating a workflow may
   * want twenty. `versioncam review` enforces whatever is here, the authoring
   * loop aims at it, and `--min`/`--max` override it for one run.
   */
  minSeconds?: number;
  maxSeconds?: number;
};

export type CursorStart = {
  /** Fractions of the viewport: `{ x: 0.72, y: 0.28 }` is up and to the right. */
  x: number;
  y: number;
};

/**
 * How to start the app when nothing is serving it yet.
 *
 * Playwright's `webServer`, field for field where Playwright has one, because
 * everyone who would use this has already learned it. Without it the app has
 * to be running before any command that drives it — which is a thing a person
 * remembers and an agent working in a repository it has never seen does not.
 */
export type WebServerConfig = {
  /** Run through a shell. Relative paths resolve against `cwd`. */
  command: string;
  /** What to wait for. Defaults to `baseUrl`. */
  url?: string;
  /** Defaults to the config file's directory. */
  cwd?: string;
  /** Default 120 000 — a map app's cold start, not a static page's. */
  timeoutMs?: number;
  /**
   * Use a server that is already answering instead of starting one.
   *
   * Default `true`, and `false` when `process.env.CI` is set: on a developer's
   * machine the server that is up is almost always theirs and the right one,
   * and in CI one that is up before the job started it is something else.
   */
  reuseExistingServer?: boolean;
  /** Merged over `process.env` for the child only. */
  env?: Record<string, string>;
};

export type ResolvedWebServer = Required<WebServerConfig>;

export type RecorderConfig = {
  /** Where the app is served. */
  baseUrl: string;
  /** How to start it when it is not being served. Absent: it must already be. */
  webServer?: WebServerConfig;
  viewport?: { width: number; height: number };
  /**
   * Device pixel ratio to capture at. 2 means a zoom reads real pixels rather
   * than upscaled ones.
   */
  dpr?: number;
  fps?: number;
  /** Glob(s) for clip files, relative to the config. */
  clips?: string | string[];
  /** Everything the recorder writes. Gitignore it. */
  outDir?: string;
  auth?: AuthConfig;
  settle?: SettleConfig;
  capture?: CaptureConfig;
  review?: ReviewConfig;
  /**
   * Where the cursor rests in the first captured frame, in fractions of the
   * viewport. Default `{ x: 0.72, y: 0.28 }`.
   *
   * There is no good default, which is the point of the field. The original
   * was picked to sit over open map and clear of the toolbars of the first app
   * this recorded, and a reviewer has since failed a clip's opening frame on
   * two different apps for landing on something: a list row in one, a
   * "Select metrics" input in the other. `open()` captures frame 0 before a
   * clip body's first line runs, so
   * no `moveTo` can reach it — an app whose layout puts a control there has to
   * say so here.
   */
  cursorStart?: CursorStart;
  clock?: {
    /** The instant the app's fake clock starts at. */
    time?: string | Date;
    timezoneId?: string;
    locale?: string;
  };
  theme?: {
    /** Click ripple and highlight ring. */
    accent?: string;
    cursorScale?: number;
    presentation?: Presentation;
  };
  /**
   * Output width; the height follows the viewport's aspect. `threads` fixes
   * how many threads each encoder uses. The bytes an encoder writes depend on
   * its thread count, which by default follows the machine's cores, so two
   * machines render the same recording to different files; fixing it is what
   * makes a render reproducible anywhere, and what version.cam's renderer
   * does. `VERSIONCAM_FFMPEG_THREADS` sets it for one run.
   */
  output?: { width?: number; threads?: number };
  motion?: Partial<Motion>;
  /** Module whose default export is `Record<string, Scene>`. */
  scenes?: string;
  /** Clip ids, in order, for `versioncam render --sequence`. */
  sequence?: string[];
};

export type ResolvedConfig = {
  root: string;
  baseUrl: string;
  webServer: ResolvedWebServer | null;
  viewport: { width: number; height: number };
  dpr: number;
  fps: number;
  clips: string[];
  outDir: string;
  recordingsDir: string;
  outputDir: string;
  cacheDir: string;
  auth: AuthConfig | null;
  settle: Required<Omit<SettleConfig, "ready">> & {
    ready: ((page: Page) => Promise<boolean>) | null;
  };
  capture: Required<CaptureConfig>;
  review: Required<ReviewConfig>;
  cursorStart: CursorStart;
  clock: { time: Date; timezoneId: string; locale: string };
  theme: {
    accent: string;
    cursorScale: number;
    presentation: Presentation | null;
  };
  output: { width: number; height: number };
  /** Threads per encoder, or null for ffmpeg's own choice. */
  encoderThreads: number | null;
  motion: Motion;
  scenes: string | null;
  sequence: string[] | null;
};

/** Typed identity, so a config file gets completion and checking. */
export function defineRecorder(config: RecorderConfig): RecorderConfig {
  return config;
}

function fail(field: string, why: string): never {
  throw new Error(`versioncam config: \`${field}\` ${why}`);
}

/**
 * The environment wins over the config, so a machine (version.cam's renderer,
 * a CI job) can pin the thread count of a repository that does not.
 */
function threadsOf(configured: number | undefined): number | null {
  const fromEnv = process.env.VERSIONCAM_FFMPEG_THREADS;
  if (fromEnv !== undefined && fromEnv !== "") {
    const n = Number(fromEnv);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `VERSIONCAM_FFMPEG_THREADS must be a whole number of 1 or more, got "${fromEnv}".`,
      );
    }
    return n;
  }
  if (configured === undefined) return null;
  return positiveInt(configured, "output.threads");
}

function positiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    fail(field, `must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * A caption inset names one side, and a distance that keeps the caption on
 * the video.
 *
 * Checked because a caption placed off the video fails the way nothing in
 * the presentation layer should: without an error, and without a caption.
 */
function checkCaptionInset(inset: CaptionInset, outputWidth: number): void {
  const field = "theme.presentation.captionInset";
  const given = inset as { left?: unknown; right?: unknown } | null;
  const sides = (["left", "right"] as const).filter(
    (side) => given?.[side] !== undefined,
  );
  if (given === null || sides.length !== 1) {
    fail(field, "must be `{ left: n }` or `{ right: n }`, one side only");
  }
  const px = given[sides[0]];
  if (typeof px !== "number" || !(px >= 0 && px < outputWidth)) {
    // Quoted when it is a string, or `"40"` would read as the 40 it is not.
    const got = typeof px === "string" ? JSON.stringify(px) : String(px);
    fail(
      `${field}.${sides[0]}`,
      `must be pixels of the video, from 0 to under its width of ${outputWidth}, got ${got}`,
    );
  }
}

/**
 * Output dimensions follow the viewport's aspect.
 *
 * Nothing is letterboxed and nothing is cropped: record at 1440x900 and the
 * video is 16:10; want 16:9, record at 1600x900. Heights are rounded to even
 * because H.264 with yuv420p cannot encode an odd dimension.
 */
export function outputSize(
  viewport: { width: number; height: number },
  width: number,
): { width: number; height: number } {
  const exact = (width * viewport.height) / viewport.width;
  return { width, height: 2 * Math.round(exact / 2) };
}

/**
 * Every field filled, so the code that starts the server never has to know a
 * default.
 *
 * `reuseExistingServer` reads `CI` here, once, rather than at the moment of
 * starting: a config is resolved per command, so this is the same moment, and
 * a resolved config that says what it will do is easier to reason about than
 * one that looks at the environment again later.
 */
function resolveWebServer(
  server: WebServerConfig,
  baseUrl: string,
  root: string,
): ResolvedWebServer {
  if (typeof server.command !== "string" || server.command.trim() === "") {
    fail("webServer.command", "must be a non-empty string");
  }
  const url = server.url ?? baseUrl;
  // `URL.canParse("localhost:5174")` is true — a scheme called `localhost` —
  // and that is exactly the string someone types, so ask for the protocol.
  if (!/^https?:$/.test(URL.canParse(url) ? new URL(url).protocol : "")) {
    fail("webServer.url", `must be an http(s) URL, got ${url}`);
  }
  const timeoutMs = positiveInt(
    server.timeoutMs ?? 120_000,
    "webServer.timeoutMs",
  );
  return {
    command: server.command,
    url,
    cwd: server.cwd === undefined ? root : resolve(root, server.cwd),
    timeoutMs,
    reuseExistingServer: server.reuseExistingServer ?? !process.env.CI,
    env: server.env ?? {},
  };
}

export function resolveConfig(
  config: RecorderConfig,
  root: string,
): ResolvedConfig {
  if (typeof config.baseUrl !== "string" || config.baseUrl.length === 0) {
    fail("baseUrl", "is required");
  }

  const viewport = config.viewport ?? { width: 1440, height: 900 };
  positiveInt(viewport.width, "viewport.width");
  positiveInt(viewport.height, "viewport.height");

  const dpr = config.dpr ?? 2;
  if (!(dpr >= 1 && dpr <= 3))
    fail("dpr", `must be between 1 and 3, got ${dpr}`);

  const fps = config.fps ?? 60;
  if (!Number.isInteger(fps) || fps < 10 || fps > 120) {
    fail("fps", `must be an integer between 10 and 120, got ${fps}`);
  }

  const forceCaptureEvery = config.capture?.forceCaptureEvery ?? 30;
  if (!Number.isInteger(forceCaptureEvery) || forceCaptureEvery < 1) {
    fail(
      "capture.forceCaptureEvery",
      `must be an integer of 1 or more, got ${forceCaptureEvery}`,
    );
  }

  if (config.auth) {
    const hasState = typeof config.auth.storageState === "string";
    const hasLogin = typeof config.auth.login === "function";
    if (hasState === hasLogin) {
      fail("auth", "must have exactly one of `storageState` or `login`");
    }
  }

  const presentation = config.theme?.presentation;
  if (presentation?.padding !== undefined) {
    const p = presentation.padding;
    if (!(p >= 0 && p <= 0.3)) {
      fail("theme.presentation.padding", `must be between 0 and 0.3, got ${p}`);
    }
  }

  const abs = (p: string) => (isAbsolute(p) ? p : resolve(root, p));
  const outDir = abs(config.outDir ?? ".versioncam");
  const outputWidth = config.output?.width ?? 1920;
  positiveInt(outputWidth, "output.width");
  const encoderThreads = threadsOf(config.output?.threads);
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  if (presentation?.captionInset !== undefined) {
    checkCaptionInset(presentation.captionInset, outputWidth);
  }

  return {
    root,
    baseUrl,
    webServer: config.webServer
      ? resolveWebServer(config.webServer, baseUrl, root)
      : null,
    viewport,
    dpr,
    fps,
    clips:
      config.clips === undefined
        ? ["demos/**/*.clip.ts"]
        : Array.isArray(config.clips)
          ? config.clips
          : [config.clips],
    outDir,
    recordingsDir: resolve(outDir, "recordings"),
    outputDir: resolve(outDir, "out"),
    cacheDir: resolve(outDir, ".cache"),
    auth: config.auth ?? null,
    settle: {
      quietMs: config.settle?.quietMs ?? 150,
      timeoutMs: config.settle?.timeoutMs ?? 15_000,
      yieldMs: config.settle?.yieldMs ?? 20,
      ready: config.settle?.ready ?? null,
    },
    capture: {
      gate: config.capture?.gate ?? true,
      forceCaptureEvery: forceCaptureEvery,
      transitions: transitionsOf(
        config.capture?.transitions,
        "capture.transitions",
      ),
    },
    review: {
      minSeconds: config.review?.minSeconds ?? 9,
      maxSeconds: config.review?.maxSeconds ?? 11,
    },
    cursorStart: {
      x: config.cursorStart?.x ?? 0.72,
      y: config.cursorStart?.y ?? 0.28,
    },
    clock: {
      time: new Date(config.clock?.time ?? "2026-09-01T09:00:00Z"),
      timezoneId: config.clock?.timezoneId ?? "UTC",
      locale: config.clock?.locale ?? "en-GB",
    },
    theme: {
      // A neutral blue, not anyone's brand. An app says its own accent.
      accent: config.theme?.accent ?? "#2f6fed",
      cursorScale: config.theme?.cursorScale ?? 2.1,
      presentation: presentation ?? null,
    },
    output: outputSize(viewport, outputWidth),
    encoderThreads,
    motion: { ...MOTION, ...config.motion },
    scenes: config.scenes ? abs(config.scenes) : null,
    sequence: config.sequence ?? null,
  };
}

/** The subset the render page needs, serialised to `/render-config.json`. */
export type RenderConfig = {
  output: { width: number; height: number };
  theme: {
    accent: string;
    cursorScale: number;
    presentation: Presentation | null;
  };
  motion: Motion;
  /**
   * The scenes module's path. The page is served a bundle of it, and names
   * the file it came from when it cannot read the scenes out of it.
   */
  scenes: string | null;
};

export function renderConfigOf(config: ResolvedConfig): RenderConfig {
  return {
    output: config.output,
    theme: config.theme,
    motion: config.motion,
    scenes: config.scenes,
  };
}
