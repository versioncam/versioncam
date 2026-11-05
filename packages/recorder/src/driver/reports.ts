import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { setTimeout as sleep } from "node:timers/promises";
import { hasDevTools, showDevTools } from "./page-hooks.js";
import { withinMs } from "./settle.js";
import type { Rect } from "../core/timeline.js";
import type { SettleReport } from "./settle.js";

/**
 * What a recording leaves behind besides its frames.
 *
 * A clip is written by someone who was not watching it run — increasingly,
 * by something that cannot watch at all — so everything that would have been
 * on screen has to be on disk. What the waits waited for; where each step's
 * target was; and, if it ended badly, the page at the moment it gave up.
 */

/** The name a reader looks for, in one place. */
export const SETTLES_FILE = "settles.json";
export const FAILURE_JSON = "failure.json";
export const FAILURE_PNG = "failure.png";
export const FAILURE_TOOLS_PNG = "failure-tools.png";
export const TARGETS_FILE = "targets.json";

export function writeSettles(dir: string, reports: SettleReport[]): void {
  writeFileSync(
    join(dir, SETTLES_FILE),
    `${JSON.stringify(reports, null, 2)}\n`,
  );
}

/**
 * Where each step's target was on the page when the step began, by the step's
 * index in the timeline's `steps`, in CSS pixels of the viewport.
 *
 * Beside the timeline rather than in it, because the timeline is the golden
 * contract between capture and render and this is for neither of them: it is
 * what lets version.cam crop a screenshot to the control a step used. Only a
 * step that measured a target has an entry, and it is the first target the
 * step measured, which for `typeInto` is the field and for `drag` is where the
 * drag began.
 */
export type Targets = Record<string, Rect>;

export function writeTargets(dir: string, targets: Targets): void {
  writeFileSync(
    join(dir, TARGETS_FILE),
    `${JSON.stringify(targets, null, 2)}\n`,
  );
}

export type Failure = {
  message: string;
  /** The last frame captured before it gave up; -1 if none was. */
  frame: number;
  /** Authored seconds, which is where in the script to look. */
  t: number;
  /**
   * The step that was running: its index in the timeline's `steps` and the
   * call, such as `click`. Null when it failed before the first step, and
   * absent from failures written before 0.3.0.
   */
  step?: { index: number; call: string } | null;
};

/**
 * The failure, then the picture of it.
 *
 * In that order deliberately: the message, the frame and the time can be
 * reconstructed from nothing else, while a screenshot needs a live page and
 * may not be available — a crashed browser, a context already gone. Losing the
 * picture must not lose the rest, and neither may mask the error that caused
 * this to be called in the first place.
 */
export async function writeFailure(
  page: Page,
  dir: string,
  failure: Failure,
  options: { draft?: boolean } = {},
): Promise<void> {
  try {
    writeFileSync(
      join(dir, FAILURE_JSON),
      `${JSON.stringify(failure, null, 2)}\n`,
    );
    const shoot = async (name: string): Promise<void> => {
      writeFileSync(
        join(dir, name),
        await page.screenshot({
          type: "png",
          caret: "initial",
          // A page stuck between two documents holds this too, and the failure
          // that brought us here must not wait on a picture of it.
          timeout: 10_000,
          // At the same scale the clip's own frames were captured at, so a
          // draft's evidence is as cheap to look at as its states are.
          scale: options.draft ? "css" : "device",
        }),
      );
    };
    await shoot(FAILURE_PNG);

    // The picture of why it failed may be the one thing the recorder hid: a
    // build error in Next's overlay, with the app blank behind it. So where a
    // page has such tools there is a second picture, with them showing. That
    // overlay mounts and draws from its own timers, and the page's clock stopped
    // with the clip, so it gets a moment of both clocks before anyone can tell
    // whether it is there at all. Which is why it is a second picture: time has
    // moved, and a control that "nothing matched" could be in it, so the first
    // stays the page as it stood. All of it bounded, since a page stuck between
    // two documents holds these calls as well.
    await withinMs(
      showDevTools(page).catch(() => undefined),
      2_000,
    );
    for (let round = 0; round < 2; round += 1) {
      await withinMs(
        page.clock.runFor(600).catch(() => undefined),
        2_000,
      );
      await sleep(400);
    }
    const tools = await withinMs(
      hasDevTools(page).catch(() => false),
      2_000,
    );
    if (tools) await shoot(FAILURE_TOOLS_PNG);
  } catch {
    // Nothing to do about it here, and the original failure is on its way up.
  }
}

/**
 * A failure that happened before the run had a page to record (a saved
 * session the browser refused, a clip whose viewport is invalid) leaves no
 * report of its own. This writes the message where a later step looks for
 * one, with no step, no frame and no picture, so `publish` and `--report`
 * still say that the clip failed and why. A report the run did write is kept.
 */
export function ensureFailure(dir: string, error: Error): void {
  if (existsSync(join(dir, FAILURE_JSON))) return;
  try {
    mkdirSync(dir, { recursive: true });
    const failure: Failure = {
      message: error.message,
      frame: -1,
      t: 0,
      step: null,
    };
    writeFileSync(
      join(dir, FAILURE_JSON),
      `${JSON.stringify(failure, null, 2)}\n`,
    );
  } catch {
    // The error itself is on its way to the terminal either way.
  }
}
