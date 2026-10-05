import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Browser } from "playwright";
import { isTransitions } from "../config.js";
import type { CaptureConfig, ResolvedConfig } from "../config.js";
import type { Timeline } from "../core/timeline.js";
import type { RecordingTiming } from "../core/timing.js";
import {
  MUTATION_COUNTER_SCRIPT,
  TRANSITION_CLOCK_SCRIPT,
  freezeCssScript,
} from "./page-hooks.js";
import { writeFailure, writeSettles, writeTargets } from "./reports.js";
import type { SettleReport } from "./settle.js";
import { RecordingSession } from "./session.js";

export type ClipOptions = {
  /**
   * The clip's name, kept in its timeline. Not a caption: nothing draws it,
   * and a body that wants words on screen writes `s.caption`.
   */
  title: string;
  /** Per-clip overrides of the config, for a clip that needs a different shape. */
  viewport?: { width: number; height: number };
  dpr?: number;
  fps?: number;
  /** Seeds the jitter in cursor paths, dwells and typing. */
  seed?: number;
  /**
   * Per-clip capture overrides. A clip that films a canvas sets
   * `forceCaptureEvery: 1` here rather than making every other clip pay, and
   * a clip whose app animates in ways better left out sets
   * `transitions: "zero"`.
   */
  capture?: CaptureConfig;
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

/**
 * This package's version, for the recording's provenance: which versioncam
 * made it, read by whoever shows the recording rather than guessed from the
 * latest release.
 */
export const RECORDER_VERSION = (
  createRequire(import.meta.url)("../../package.json") as { version: string }
).version;

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

export type RunClipResult = {
  timeline: Timeline;
  dir: string;
  /** What it cost in real time. Diagnostics; never part of the recording. */
  cost: RecordingTiming;
  /**
   * Every settle, in order. The same list `settles.json` holds, for a caller
   * that would otherwise read back the file it just caused to be written.
   */
  settles: SettleReport[];
};

/**
 * Record one clip.
 *
 * A fresh context each time, with the fake clock paused before any navigation
 * so the app's own boot timers are fake from the first tick.
 */
export type RunClipOptions = {
  /**
   * Record cheaply, for looking at while writing the clip.
   *
   * Fifteen frames a second instead of sixty, captured at CSS scale instead of
   * device scale — at 1440×900 on a retina context that is 25 ms a frame
   * rather than 67 ms, for a quarter as many frames.
   *
   * What it deliberately does *not* change is the page. The context keeps its
   * device pixel ratio and its viewport, so the app lays out identically and
   * runs the same code; a draft that reduced the DPR could pass while the full
   * capture it stands in for fails on a media query.
   */
  draft?: boolean;
};

export async function runClip(
  browser: Browser,
  config: ResolvedConfig,
  definition: ClipDefinition,
  runOptions: RunClipOptions = {},
): Promise<RunClipResult> {
  const { id, options, body } = definition;
  const draft = runOptions.draft ?? false;
  const viewport = options.viewport ?? config.viewport;
  const dpr = options.dpr ?? config.dpr;
  // A draft ignores a clip's own frame rate: the point is to be cheap, and a
  // clip asking for 60 would quietly cost four times what the flag promises.
  const fps = draft ? 15 : (options.fps ?? config.fps);
  const capture = { ...config.capture, ...options.capture };

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

  // A clip's own `capture` is merged over the config's unchecked, so its
  // switch is checked here, where a typo would otherwise play by default.
  const transitions = capture.transitions;
  if (!isTransitions(transitions)) {
    throw new Error(
      `Clip "${id}": \`capture.transitions\` must be "play" or "zero", got ${JSON.stringify(transitions)}.`,
    );
  }
  await page.addInitScript(MUTATION_COUNTER_SCRIPT);
  await page.addInitScript(freezeCssScript(transitions));
  if (transitions === "play") await page.addInitScript(TRANSITION_CLOCK_SCRIPT);
  // Paused, not just installed. `clock.install()` leaves Playwright's fake
  // clock running on real time between the driver's own `runFor` calls, so
  // every screenshot, every probe and every stall of the machine reached the
  // page as time: on the Linux runner one slow frame moved the page's clock
  // 840 ms instead of 67, and the example app's 800 ms timer fired seven
  // frames early. Paused, it moves only when the driver moves it — 1/fps a
  // frame, a tick at a time while it waits — and it starts at exactly
  // `clock.time` instead of that plus however long the navigation took.
  await page.clock.pauseAt(config.clock.time);

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
    recorder: RECORDER_VERSION,
    capture,
    draft,
    config,
  });

  try {
    await body(session.forClipBody());
    if (documentLoads > 1) {
      throw new Error(
        `The document reloaded ${documentLoads - 1} time(s) during "${id}". ` +
          "The usual cause is editing a file while recording: a dev server " +
          "pushes a full reload to every open client. Re-record without " +
          "touching the working tree.",
      );
    }
    const timeline = session.finish();
    writeSettles(dir, session.settles);
    writeTargets(dir, session.evidence().targets);
    return { timeline, dir, cost: session.cost, settles: session.settles };
  } catch (error) {
    // Here rather than in the caller, because the context closes below and the
    // page is the one piece of evidence that cannot be recovered afterwards:
    // by the time an error reaches `record`, the app it failed on is gone.
    //
    // Nothing in this block may throw, or it would replace the failure it
    // exists to report — a disk error standing in for the locator that broke.
    const evidence = session.evidence();
    try {
      writeSettles(dir, session.settles);
      writeTargets(dir, evidence.targets);
    } catch {
      // Said by the error on its way up, which is the more useful of the two.
    }
    await writeFailure(
      page,
      dir,
      { message: (error as Error).message, ...session.at, step: evidence.step },
      { draft },
    );
    throw error;
  } finally {
    await context.close();
  }
}
