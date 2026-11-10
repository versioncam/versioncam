import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Browser } from "playwright";
import { isTransitions } from "../config.js";
import type { CaptureConfig, ResolvedConfig } from "../config.js";
import type { Timeline } from "../core/timeline.js";
import type { RecordingTiming } from "../core/timing.js";
import { sendHeaders } from "./headers.js";
import {
  INSTANT_SCROLL_SCRIPT,
  MUTATION_COUNTER_SCRIPT,
  TRANSITION_CLOCK_SCRIPT,
  freezeCssScript,
} from "./page-hooks.js";
import { ClipReplay } from "./replay.js";
import type { ReplayMode } from "./replay.js";
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
  /**
   * The replay's mode for this run, over the config's: what `--replay` on
   * the command line sets.
   */
  replay?: ReplayMode;
  /** How long a page may take to arrive, for a test that cannot wait 90 s. */
  arriveWithinMs?: number;
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

  // Made first, because it refuses a clip told to replay a file that does
  // not exist, and nothing is open yet to close.
  const replay = config.replay
    ? new ClipReplay(config.replay, id, RECORDER_VERSION, runOptions.replay)
    : null;

  const context = await browser.newContext({
    // So `page.goto("/sign-in")` in a login hook or `offCamera` means what it
    // means in a Playwright test, rather than "Cannot navigate to invalid URL".
    baseURL: config.baseUrl,
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
  // Installed on the context before the page exists, so the page's first
  // request is caught. A clip's own `page.route` mocks are tried before it,
  // as Playwright tries a page's routes before its context's: what a clip
  // answers itself never reaches the replay.
  await replay?.install(context);
  // After the replay's routes, so it runs before them and a recorded
  // response is fetched with the headers too.
  await sendHeaders(context, config.headers);
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
  await page.addInitScript(INSTANT_SCROLL_SCRIPT);
  if (transitions === "play") await page.addInitScript(TRANSITION_CLOCK_SCRIPT);
  const pacing = replay?.pacingScript();
  if (pacing) await page.addInitScript(pacing);
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
  // Editing any file mid-run therefore replaces the document, and the clip goes
  // on against an app that has lost its state. So a reload fails the clip.
  //
  // A navigation does not: a plain link or a form post is how a server-rendered
  // app changes page, and the session waits it out. The browser's own account
  // tells the two apart, once the new document has loaded: a dev server's push
  // is `location.reload()`, and a link is a "push". Asked of the Navigation API
  // because the page's fake clock hides `performance.getEntriesByType`.
  //
  // Asked from "load" rather than "framenavigated": the latter also fires for
  // History API pushes, which never replaced anything.
  //
  // Only once there is a frame to lose. A page that reloads itself as it opens,
  // as Vite does on a first visit when it finds a dependency to optimize, has
  // filmed nothing yet, and the first settle waits for the page that stays.
  let reloads = 0;
  const loads: Promise<void>[] = [];
  page.on("load", () => {
    if (session.at.frame < 0) return;
    loads.push(
      page
        .evaluate(() => {
          // Not in TypeScript's DOM types yet; Chromium has had it since 123.
          const { navigation } = window as unknown as {
            navigation?: { activation?: { navigationType?: string } };
          };
          return navigation?.activation?.navigationType;
        })
        .then((type) => {
          if (type === "reload") reloads += 1;
        })
        // Replaced again already, or closed: what comes next is what counts.
        .catch(() => undefined),
    );
  });
  const reloaded = async (): Promise<string | null> => {
    await Promise.all(loads);
    return reloads === 0
      ? null
      : `The document reloaded ${reloads} time(s) during "${id}". ` +
          "The usual cause is editing a file while recording: a dev server " +
          "pushes a full reload to every open client. Re-record without " +
          "touching the working tree. An app that reloads itself on purpose, " +
          "after a settings change say, cannot be filmed past that point; a " +
          "link or a form post to the same page can.";
  };

  // What the page threw. The recorder hides Next's dev tools, whose error dialog
  // goes with its badge, so a thrown error has to be told some other way, or the
  // recorder would make a video quietly wrong: a warning for a clip that goes on,
  // and the cause beside the failure of one that does not.
  const thrown: string[] = [];
  page.on("pageerror", (error) => {
    if (!thrown.includes(error.message)) thrown.push(error.message);
  });
  const threw = (): string =>
    `The page threw during "${id}": ${thrown.slice(0, 3).join("; ")}` +
    (thrown.length > 3 ? `; and ${thrown.length - 3} more.` : ".");

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
    replay,
    arriveWithinMs: runOptions.arriveWithinMs,
  });

  try {
    try {
      await body(session.forClipBody());
    } catch (error) {
      // A request the replay could not answer failed in the page, and the
      // page then failed the clip somewhere else: a locator that never
      // appeared, a settle that ran out. The missing response is the cause.
      const missing = replay?.failure();
      if (missing) (error as Error).message += `\n\n${missing}`;
      // The same for a reload: the control a clip could not find is usually
      // gone because the page started over.
      const pushed = await reloaded();
      if (pushed) (error as Error).message += `\n\n${pushed}`;
      if (thrown.length > 0) (error as Error).message += `\n\n${threw()}`;
      throw error;
    }
    const missing = replay?.failure();
    if (missing) throw new Error(missing);
    const pushed = await reloaded();
    if (pushed) throw new Error(pushed);
    if (thrown.length > 0) {
      console.warn(`[recorder] ${threw()} The clip went on.`);
    }
    const timeline = session.finish();
    writeSettles(dir, session.settles);
    writeTargets(dir, session.evidence().targets);
    replay?.write();
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
