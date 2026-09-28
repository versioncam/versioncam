import type { Page } from "playwright";
import { setTimeout as sleep } from "node:timers/promises";

export type SettleOptions = {
  /** How long the page must be quiet before we call it settled, in ms of ticks. */
  quietMs?: number;
  /** Real-time cap. Exceeding it logs loudly rather than failing the clip. */
  timeoutMs?: number;
  /** Extra condition, e.g. "the map has finished loading tiles". */
  hook?: () => Promise<boolean>;
  /** Named in the log line so a slow settle is diagnosable. */
  label?: string;
  /**
   * Real milliseconds to yield per tick. See the note on `settlePage`: fake
   * time alone does not let the network or the renderer do anything.
   */
  yieldMs?: number;
};

export type SettleReport = {
  label: string;
  elapsedMs: number;
  ticks: number;
  timedOut: boolean;
  lastBlocker: string;
};

/** One step of the page's clock whenever the recorder waits on the page. */
export const TICK_MS = 16;
const DEFAULT_YIELD_MS = 20;

/**
 * Advance the page's clock until nothing is happening any more.
 *
 * Nothing is captured while this runs, which is what lets a clip show a
 * DuckDB query "returning instantly": the wait happens, it just never reaches
 * the timeline. The cost of getting this wrong is a frame captured mid-update,
 * so the checks are deliberately conservative — DOM quiet *and* no network in
 * flight *and* fonts loaded *and* whatever the clip adds.
 *
 * Each iteration advances fake time *and* yields real time. `clock.runFor()`
 * only moves the page's own timeline: it fires due timers and resolves, but it
 * does not wait, so a loop built from it alone burns its entire timeout in
 * milliseconds while the app has had no opportunity to answer a fetch or paint
 * a tile. Both clocks have to move for a settle to mean anything.
 */
export async function settlePage(
  page: Page,
  inFlightRequests: () => number,
  options: SettleOptions = {},
): Promise<SettleReport> {
  const quietMs = options.quietMs ?? 150;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const label = options.label ?? "settle";
  const ticksNeeded = Math.max(1, Math.ceil(quietMs / TICK_MS));

  const started = Date.now();
  let quietTicks = 0;
  let ticks = 0;
  let lastMutations = -1;
  let lastBlocker = "none";

  for (;;) {
    const probe = await page.evaluate(() => ({
      mutations: window.__recorder?.mutations ?? 0,
      fontsLoaded: document.fonts ? document.fonts.status === "loaded" : true,
    }));
    const requests = inFlightRequests();
    const hookOk = options.hook ? await options.hook() : true;

    const quiet =
      probe.mutations === lastMutations &&
      requests === 0 &&
      probe.fontsLoaded &&
      hookOk;

    if (!quiet) {
      if (probe.mutations !== lastMutations) lastBlocker = "dom";
      else if (requests > 0) lastBlocker = `requests(${requests})`;
      else if (!probe.fontsLoaded) lastBlocker = "fonts";
      else lastBlocker = "hook";
    }

    lastMutations = probe.mutations;
    quietTicks = quiet ? quietTicks + 1 : 0;
    if (quietTicks >= ticksNeeded) {
      return {
        label,
        elapsedMs: Date.now() - started,
        ticks,
        timedOut: false,
        lastBlocker,
      };
    }

    if (Date.now() - started > timeoutMs) {
      // Not an error: a clip that ends on a still of a half-loaded panel is
      // a better failure than one that dies at frame 300. The log line is how
      // it gets noticed.
      console.warn(
        `[recorder] ${label} gave up waiting after ${timeoutMs}ms ` +
          `(still ${lastBlocker}) and carried on. What follows may show a ` +
          `half-loaded page.`,
      );
      return {
        label,
        elapsedMs: Date.now() - started,
        ticks,
        timedOut: true,
        lastBlocker,
      };
    }

    await page.clock.runFor(TICK_MS);
    await sleep(options.yieldMs ?? DEFAULT_YIELD_MS);
    ticks += 1;
  }
}
