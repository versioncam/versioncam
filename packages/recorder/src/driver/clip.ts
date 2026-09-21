import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Browser } from "playwright";
import type { ResolvedConfig } from "../config";
import type { Timeline } from "../core/timeline";
import { FREEZE_CSS_SCRIPT, MUTATION_COUNTER_SCRIPT } from "./page-hooks";
import { RecordingSession } from "./session";

export type ClipOptions = {
  /** Shown as the clip's caption, unless the body sets its own. */
  title: string;
  /** Per-clip overrides of the config, for a clip that needs a different shape. */
  viewport?: { width: number; height: number };
  dpr?: number;
  fps?: number;
  /** Seeds the jitter in cursor paths, dwells and typing. */
  seed?: number;
};

export type ClipBody = (session: RecordingSession) => Promise<void>;

export type ClipDefinition = {
  id: string;
  options: ClipOptions;
  body: ClipBody;
};

/**
 * Declare a clip.
 *
 * This only describes one — running it is `runClip`, which the CLI does. The
 * prototype registered a Playwright test here instead, which worked but meant
 * every way of recording had to go through a test runner.
 */
export function clip(
  id: string,
  options: ClipOptions,
  body: ClipBody,
): ClipDefinition {
  return { id, options, body };
}

/** The app's commit, for the recording's provenance. Best effort. */
function appCommit(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export type RunClipResult = { timeline: Timeline; dir: string };

/**
 * Record one clip.
 *
 * A fresh context each time, with the fake clock installed before any
 * navigation so the app's own boot timers are fake from the first tick.
 */
export async function runClip(
  browser: Browser,
  config: ResolvedConfig,
  definition: ClipDefinition,
): Promise<RunClipResult> {
  const { id, options, body } = definition;
  const viewport = options.viewport ?? config.viewport;
  const dpr = options.dpr ?? config.dpr;
  const fps = options.fps ?? config.fps;

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    // The app should render its normal motion design; the freeze script is
    // narrower than reduced-motion and does not change layout.
    reducedMotion: "no-preference",
    // A fixed timezone and locale keep any rendered date identical run to run.
    timezoneId: config.clock.timezoneId,
    locale: config.clock.locale,
    storageState: config.auth?.storageState,
  });
  const page = await context.newPage();

  await page.addInitScript(MUTATION_COUNTER_SCRIPT);
  await page.addInitScript(FREEZE_CSS_SCRIPT);
  await page.clock.install({ time: config.clock.time });

  // A dev server broadcasts a full page reload to every connected client when
  // it cannot hot-update a changed module, including a page being recorded.
  // Editing any file mid-run therefore replaces the document, which otherwise
  // surfaces as an inscrutable "Execution context was destroyed" from
  // whichever evaluate lost the race.
  //
  // Counted from "load" rather than "framenavigated": the latter also fires
  // for History API pushes, and an app that routes client-side would report
  // navigations that never replaced anything.
  let documentLoads = 0;
  page.on("load", () => {
    documentLoads += 1;
  });

  const dir = join(config.recordingsDir, id);
  const session = new RecordingSession(page, {
    clipId: id,
    title: options.title,
    fps,
    viewport,
    dpr,
    seed: options.seed ?? 1,
    outputDir: dir,
    appCommit: appCommit(config.root),
    config,
  });

  try {
    await body(session);
    if (documentLoads > 1) {
      throw new Error(
        `The document reloaded ${documentLoads - 1} time(s) during "${id}". ` +
          "The usual cause is editing a file while recording: a dev server " +
          "pushes a full reload to every open client. Re-record without " +
          "touching the working tree.",
      );
    }
    return { timeline: session.finish(), dir };
  } finally {
    await context.close();
  }
}
