import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { SettleReport } from "./settle.js";

/**
 * What a recording leaves behind besides its frames.
 *
 * A clip is written by someone who was not watching it run — increasingly,
 * by something that cannot watch at all — so everything that would have been
 * on screen has to be on disk. Two files: what the waits waited for, and, if
 * it ended badly, the page at the moment it gave up.
 */

/** The name a reader looks for, in one place. */
export const SETTLES_FILE = "settles.json";
export const FAILURE_JSON = "failure.json";
export const FAILURE_PNG = "failure.png";

export function writeSettles(dir: string, reports: SettleReport[]): void {
  writeFileSync(
    join(dir, SETTLES_FILE),
    `${JSON.stringify(reports, null, 2)}\n`,
  );
}

export type Failure = {
  message: string;
  /** The last frame captured before it gave up; -1 if none was. */
  frame: number;
  /** Authored seconds, which is where in the script to look. */
  t: number;
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
    writeFileSync(
      join(dir, FAILURE_PNG),
      await page.screenshot({
        type: "png",
        caret: "initial",
        // At the same scale the clip's own frames were captured at, so a
        // draft's evidence is as cheap to look at as its states are.
        scale: options.draft ? "css" : "device",
      }),
    );
  } catch {
    // Nothing to do about it here, and the original failure is on its way up.
  }
}
