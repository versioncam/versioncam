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

type SettleProbe = {
  mutations: number;
  fontsLoaded: boolean;
  transitions: number;
  replays: number;
};

export type SettleReport = {
  label: string;
  elapsedMs: number;
  ticks: number;
  timedOut: boolean;
  lastBlocker: string;
};

/** What a settle reads from a page that is not there to ask. Never quiet. */
const GONE: SettleProbe = {
  mutations: -1,
  fontsLoaded: false,
  transitions: 0,
  replays: 0,
};

/**
 * `work`, or null once `ms` have gone by.
 *
 * A call that loses is left to finish on its own, and whatever it comes to is
 * nobody's business by then: a rejection must not surface as an unhandled one.
 * The timer is cleared when the work wins, or it would hold the process open.
 */
export function withinMs<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

/** One step of the page's clock whenever the recorder waits on the page. */
export const TICK_MS = 16;
const DEFAULT_YIELD_MS = 20;

/**
 * The least time a settle's probe is given to answer, even at the deadline.
 *
 * A page answers in a few milliseconds, and the pass that ends a settle begins
 * when the time is up or nearly so. Cut off at the deadline, that probe would
 * be taken for one held by a navigation, so nearly every settle that gave up
 * said it was waiting on a navigation, whatever held it. With this much time,
 * a probe that does not answer really was held, and one that does says what
 * the page is still doing.
 */
const PROBE_GRACE_MS = 250;

/**
 * Did this call fail because the page's document went away under it?
 *
 * A plain link or a form post destroys the context a probe was running in, and
 * Playwright rejects the call. On a server-rendered app that is how every page
 * changes, so it is an ordinary event to wait out, and not a failure of the
 * clip. A closed page is a different message and a real failure, and stays one.
 */
export function isNavigationError(error: unknown): boolean {
  const message = (error as Error | undefined)?.message ?? "";
  return /Execution context was destroyed|Cannot find context with specified id|frame was detached/i.test(
    message,
  );
}

/**
 * Advance the page's clock until nothing is happening any more.
 *
 * Nothing is captured while this runs, which is what lets a clip show a
 * DuckDB query "returning instantly": the wait happens, it just never reaches
 * the timeline. The cost of getting this wrong is a frame captured mid-update,
 * so the checks are deliberately conservative — DOM quiet *and* no network in
 * flight *and* fonts loaded *and* no transition still running *and* whatever
 * the clip adds.
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
    // The same round trip finishes the CSS animations whose time is up, so
    // whatever waits on them (a closed dialog unmounting) runs, and shows as
    // DOM work on the next tick; moves the page's transitions to its clock,
    // which the last tick advanced; and says how many are still running.
    //
    // A document replaced under the call is not quiet, and says nothing about
    // the next one: the wait starts over on the page that arrives.
    //
    // And it may not come back for a while. Chromium holds a call like this
    // from the moment a navigation starts until the new document commits, for
    // as long as the server takes. That is why the page's clock does not move
    // during that time, so what the new page reads from it does not depend on
    // the server. It is also why the call needs a limit of its own: without one
    // a server that never answers hangs the recorder, and the timeout below is
    // never reached. The limit is the time left, but never less than the
    // grace, so the last pass gets its answer too: a settle that gives up
    // overruns its timeout by a few milliseconds, or by up to the grace when
    // a navigation holds the page as the time runs out.
    let probe: SettleProbe;
    let hookOk: boolean;
    try {
      const answer = await withinMs(
        page.evaluate(() => {
          window.__recorder?.finishEnded();
          return {
            mutations: window.__recorder?.mutations ?? 0,
            fontsLoaded: document.fonts
              ? document.fonts.status === "loaded"
              : true,
            transitions: window.__recorderTransitions?.sync() ?? 0,
            replays: window.__recorderReplay?.pending ?? 0,
          };
        }),
        Math.max(PROBE_GRACE_MS, started + timeoutMs - Date.now()),
      );
      if (answer === null) {
        // Held until the time ran out, by a document on its way: the check
        // below gives up on this very pass.
        probe = GONE;
        hookOk = false;
        lastBlocker = "navigation";
      } else {
        probe = answer;
        hookOk = options.hook ? await options.hook() : true;
      }
    } catch (error) {
      if (!isNavigationError(error)) throw error;
      probe = GONE;
      hookOk = false;
      lastBlocker = "navigation";
    }
    const requests = inFlightRequests();

    // A running transition touches no DOM and no network, so the other
    // checks would call the page finished halfway through one. Waiting it out
    // is what makes the frame after a settle the same on every run: the
    // settle's length depends on the machine, so a transition still running
    // at its end would be caught at a point that does too.
    const quiet =
      probe.mutations === lastMutations &&
      requests === 0 &&
      probe.fontsLoaded &&
      probe.transitions === 0 &&
      // A paced body still arriving: between two of its pieces the page is
      // quiet, and a settle would call it finished halfway through.
      probe.replays === 0 &&
      hookOk;

    if (!quiet && probe !== GONE) {
      if (probe.mutations !== lastMutations) lastBlocker = "dom";
      else if (requests > 0) lastBlocker = `requests(${requests})`;
      else if (!probe.fontsLoaded) lastBlocker = "fonts";
      else if (probe.transitions > 0)
        lastBlocker = `transitions(${probe.transitions})`;
      else if (probe.replays > 0) lastBlocker = `replay(${probe.replays})`;
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

    if (Date.now() - started >= timeoutMs) {
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

    // Held the same way, by a navigation that starts between the probe and this.
    await withinMs(
      page.clock.runFor(TICK_MS),
      Math.max(0, started + timeoutMs - Date.now()),
    );
    await sleep(options.yieldMs ?? DEFAULT_YIELD_MS);
    ticks += 1;
  }
}
