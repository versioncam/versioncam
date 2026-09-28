import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { launchBrowser } from "../driver/launch.js";
import type { Browser, Page } from "playwright";
import { renderConfigOf } from "../config.js";
import type { ResolvedConfig } from "../config.js";
import { bundleScenes } from "../loader.js";
import type { Timeline } from "../core/timeline.js";
import {
  contactSheet as encodeContactSheet,
  encodeFromPage,
} from "./encode.js";
import type { EncodeResult } from "./encode.js";
import { distPageDir, installRenderRoutes, RENDER_ORIGIN } from "./serve.js";

export type RenderTarget =
  | { kind: "recording"; id: string; dir: string }
  | { kind: "scene"; id: string };

/**
 * Open the render page at the exact output size, at DPR 1.
 *
 * DPR 1 is deliberate: the canvas is already authored in output pixels, and a
 * device scale factor of 2 would make the screenshot twice as wide and then
 * need downscaling — a second resample on top of the one `drawImage` already
 * did.
 */
export async function openRenderPage(
  browser: Browser,
  config: ResolvedConfig,
  target: RenderTarget,
): Promise<{ page: Page; durationFrames: number; fps: number }> {
  const context = await browser.newContext({
    viewport: config.output,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    timezoneId: config.clock.timezoneId,
    locale: config.clock.locale,
  });
  const page = await context.newPage();

  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });

  await installRenderRoutes(page, {
    distDir: distPageDir(),
    renderConfig: renderConfigOf(config),
    recordingDir: target.kind === "recording" ? target.dir : undefined,
    scenesBundle: (await bundleScenes(config)) ?? undefined,
  });

  const query =
    target.kind === "recording"
      ? "recording"
      : `scene=${encodeURIComponent(target.id)}`;
  const response = await page.goto(`${RENDER_ORIGIN}/?${query}&headless=1`, {
    waitUntil: "domcontentloaded",
  });
  if (!response || !response.ok()) {
    await context.close();
    throw new Error(
      `The render page did not load (${response?.status() ?? "no response"}). ` +
        `Expected it at ${distPageDir()}. Run \`npm run build\` in the recorder package.`,
    );
  }

  await page.waitForFunction(() => window.__render !== undefined, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__render?.ready);

  const info = await page.evaluate(() => ({
    durationFrames: window.__render?.durationFrames ?? 0,
    fps: window.__render?.fps ?? 60,
  }));

  if (info.durationFrames === 0) {
    await context.close();
    throw new Error(
      `The render page reported no frames for ${target.kind} "${target.id}".` +
        (problems.length ? `\n${problems.join("\n")}` : ""),
    );
  }

  return { page, ...info };
}

export type RenderOutcome = EncodeResult & {
  id: string;
  durationFrames: number;
  fps: number;
  sheet: string;
};

async function renderTarget(
  browser: Browser,
  config: ResolvedConfig,
  target: RenderTarget,
): Promise<RenderOutcome> {
  const { page, durationFrames, fps } = await openRenderPage(
    browser,
    config,
    target,
  );
  try {
    const encoded = await encodeFromPage(page, {
      id: target.id,
      fps,
      durationFrames,
      outDir: config.outputDir,
    });
    const sheet = await encodeContactSheet(page, {
      id: target.id,
      durationFrames,
      outDir: config.outputDir,
    });
    return { ...encoded, id: target.id, durationFrames, fps, sheet };
  } finally {
    await page.context().close();
  }
}

export async function renderRecording(
  browser: Browser,
  config: ResolvedConfig,
  id: string,
): Promise<RenderOutcome> {
  const dir = join(config.recordingsDir, id);
  if (!existsSync(join(dir, "timeline.json"))) {
    throw new Error(
      `No recording for "${id}". Run \`versioncam record ${id}\` first.`,
    );
  }
  return renderTarget(browser, config, { kind: "recording", id, dir });
}

export async function renderScene(
  browser: Browser,
  config: ResolvedConfig,
  id: string,
): Promise<RenderOutcome> {
  return renderTarget(browser, config, { kind: "scene", id });
}

export async function contactSheet(
  browser: Browser,
  config: ResolvedConfig,
  target: RenderTarget,
  options: { frames?: number[] } = {},
): Promise<string> {
  const { page, durationFrames } = await openRenderPage(
    browser,
    config,
    target,
  );
  try {
    return await encodeContactSheet(page, {
      id: target.id,
      durationFrames,
      frames: options.frames,
      outDir: config.outputDir,
    });
  } finally {
    await page.context().close();
  }
}

/**
 * One frame, rendered at output size.
 *
 * The same page and the same `setFrame` the encoder drives, so this is the
 * frame that would be in the video rather than an approximation of it. A
 * contact sheet's tile is a quarter the width and settles nothing about a
 * caption's legibility or whether a control is cropped; this is the look
 * that does.
 */
export async function renderFrame(
  browser: Browser,
  config: ResolvedConfig,
  target: RenderTarget,
  frame: number,
): Promise<Buffer> {
  const { page, durationFrames } = await openRenderPage(
    browser,
    config,
    target,
  );
  try {
    if (!Number.isInteger(frame) || frame < 0 || frame >= durationFrames) {
      throw new Error(
        `Frame ${frame} is not in "${target.id}": it runs 0–${durationFrames - 1}.`,
      );
    }
    await page.evaluate((n) => window.__render?.setFrame(n), frame);
    return await page.locator("#stage").screenshot({ type: "png" });
  } finally {
    await page.context().close();
  }
}

/** The timeline of a recording on disk, for reporting without a browser. */
export async function readTimeline(
  config: ResolvedConfig,
  id: string,
): Promise<Timeline> {
  const file = join(config.recordingsDir, id, "timeline.json");
  return JSON.parse(await readFile(file, "utf8")) as Timeline;
}

export async function withBrowser<T>(
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await launchBrowser();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

declare global {
  interface Window {
    __render?: {
      ready: Promise<void>;
      setFrame: (frame: number) => Promise<void>;
      durationFrames: number;
      fps: number;
    };
  }
}
