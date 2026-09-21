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
};

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

export type RecorderConfig = {
  /** Where the app is served. */
  baseUrl: string;
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
  /** Output width; the height follows the viewport's aspect. */
  output?: { width?: number };
  motion?: Partial<Motion>;
  /** Module whose default export is `Record<string, Scene>`. */
  scenes?: string;
  /** Clip ids, in order, for `demos render --sequence`. */
  sequence?: string[];
};

export type ResolvedConfig = {
  root: string;
  baseUrl: string;
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
  clock: { time: Date; timezoneId: string; locale: string };
  theme: {
    accent: string;
    cursorScale: number;
    presentation: Presentation | null;
  };
  output: { width: number; height: number };
  motion: Motion;
  scenes: string | null;
  sequence: string[] | null;
};

/** Typed identity, so a config file gets completion and checking. */
export function defineRecorder(config: RecorderConfig): RecorderConfig {
  return config;
}

function fail(field: string, why: string): never {
  throw new Error(`recorder config: \`${field}\` ${why}`);
}

function positiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    fail(field, `must be a positive integer, got ${value}`);
  }
  return value;
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
  const outDir = abs(config.outDir ?? ".demos");
  const outputWidth = config.output?.width ?? 1920;
  positiveInt(outputWidth, "output.width");

  return {
    root,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
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
};

export function renderConfigOf(config: ResolvedConfig): RenderConfig {
  return {
    output: config.output,
    theme: config.theme,
    motion: config.motion,
  };
}
