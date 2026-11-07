import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { launchBrowser } from "../driver/launch.js";
import type { Browser, Page } from "playwright";
import { outputSize, renderConfigOf } from "../config.js";
import type { RenderConfig, ResolvedConfig } from "../config.js";
import { bundleScenes } from "../loader.js";
import type { Timeline } from "../core/timeline.js";
import {
  contactSheet as encodeContactSheet,
  encodeFromPage,
} from "./encode.js";
import type { EncodeResult } from "./encode.js";
import { evenFrames } from "./sampling.js";
import { distPageDir, installRenderRoutes, RENDER_ORIGIN } from "./serve.js";

export type RenderTarget =
  | { kind: "recording"; id: string; dir: string }
  | { kind: "scene"; id: string };

/** A recording's timeline, read from its directory, wherever that is. */
async function timelineAt(dir: string): Promise<Timeline> {
  return JSON.parse(
    await readFile(join(dir, "timeline.json"), "utf8"),
  ) as Timeline;
}

/**
 * The render config a target is drawn with: the config's, at the target's
 * own size.
 *
 * A recording renders at the shape it was recorded at, which is the clip's
 * own viewport when it sets one. `config.output` is the config's viewport
 * at `output.width`, and a phone clip recorded at 390x844 drawn on that
 * canvas was the top of its page blown up to the width. A scene has no
 * recording and draws at the config's size.
 *
 * The rule is given the output.width the config states, which is the longer
 * side of `config.output` whatever the shape of the config's viewport, and
 * that output's width only while the viewport is landscape or square. In a
 * portrait project `config.output` is already 888x1920, and its 888 taken
 * for output.width applied the rule twice: 410x888 in 0.7.1.
 *
 * `renderConfigOf` itself is left as it is: it is also what `versioncam
 * publish` sends, and version.cam sizes each render from the recording's
 * timeline by the same rule, so a publish keeps its bytes and its hash.
 */
function renderConfigWith(
  config: ResolvedConfig,
  timeline: Timeline | null,
): RenderConfig {
  return {
    ...renderConfigOf(config),
    output: timeline
      ? outputSize(
          timeline.viewport,
          Math.max(config.output.width, config.output.height),
        )
      : config.output,
  };
}

/** `renderConfigWith` for a target, for a page that is not opened here. */
export async function renderConfigFor(
  config: ResolvedConfig,
  target: RenderTarget,
): Promise<RenderConfig> {
  return renderConfigWith(
    config,
    target.kind === "recording" ? await timelineAt(target.dir) : null,
  );
}

/**
 * Open the render page at the exact output size, at DPR 1.
 *
 * DPR 1 is deliberate: the canvas is already authored in output pixels, and a
 * device scale factor of 2 would make the screenshot twice as wide and then
 * need downscaling — a second resample on top of the one `drawImage` already
 * did.
 *
 * The recording's timeline is read here, once, for the size, and handed back
 * for the sheet, which needs its cuts.
 */
export async function openRenderPage(
  browser: Browser,
  config: ResolvedConfig,
  target: RenderTarget,
): Promise<{
  page: Page;
  durationFrames: number;
  fps: number;
  timeline: Timeline | null;
}> {
  const timeline =
    target.kind === "recording" ? await timelineAt(target.dir) : null;
  const renderConfig = renderConfigWith(config, timeline);
  const context = await browser.newContext({
    viewport: renderConfig.output,
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
    renderConfig,
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
      `The render page didn't load (${response?.status() ?? "no response"}). ` +
        `It should be at ${distPageDir()}. Run \`npm run build\` in the recorder package.`,
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

  return { page, ...info, timeline };
}

export type RenderOutcome = EncodeResult & {
  id: string;
  durationFrames: number;
  fps: number;
  sheet: string;
};

/**
 * The frames a sheet shows when nobody chose them.
 *
 * For a recording, evenly spread and moved past the renderer's dissolves,
 * which only the recording's own cuts can say where they are: the timeline
 * `openRenderPage` read from its directory rather than by id, since a target
 * can be a recording anywhere. A scene, which has none, draws every frame
 * itself and never dissolves, so its sheet is the plain even spread the
 * encoder falls back on.
 */
function sheetFrames(
  config: ResolvedConfig,
  timeline: Timeline | null,
  durationFrames: number,
): number[] | undefined {
  if (!timeline) return undefined;
  return evenFrames(
    durationFrames,
    undefined,
    config.motion.crossfadeFrames,
    timeline.cuts,
  );
}

async function renderTarget(
  browser: Browser,
  config: ResolvedConfig,
  target: RenderTarget,
): Promise<RenderOutcome> {
  const { page, durationFrames, fps, timeline } = await openRenderPage(
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
      threads: config.encoderThreads,
    });
    const sheet = await encodeContactSheet(page, {
      id: target.id,
      durationFrames,
      frames: sheetFrames(config, timeline, durationFrames),
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
      `There is no recording of "${id}". If "${id}" is a clip id, run \`npx versioncam record ${id}\` first.`,
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
  const { page, durationFrames, timeline } = await openRenderPage(
    browser,
    config,
    target,
  );
  try {
    return await encodeContactSheet(page, {
      id: target.id,
      durationFrames,
      frames: options.frames ?? sheetFrames(config, timeline, durationFrames),
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
        `"${target.id}" has frames 0 to ${durationFrames - 1}, so there is no frame ${frame}.`,
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
  return timelineAt(join(config.recordingsDir, id));
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
