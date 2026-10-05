import { expect, test } from "@playwright/test";
import type { Browser } from "playwright";
import type { CaptureConfig, RecorderConfig } from "../src/config.js";
import { compareRecordings } from "../src/driver/compare.js";
import { clip, runClip } from "../src/driver/clip.js";
import type { ClipBody } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * CSS transitions play on the clip's clock (docs/wp12-transitions.md).
 *
 * The recorder used to set every transition to zero, so a change made inside
 * a hold, like a map zooming on a wheel notch, landed in one frame as a jump.
 * Now a transition starts when the driver first sees it, moves with the
 * page's clock, frame by frame, and ends when its own time is up, on every
 * run the same. These tests read the page's computed transform after each
 * frame, which is the state that frame was photographed in, and its clock,
 * which is what the transition is timed by.
 */

type Sample = { now: number; scale: number };
type PageEvent = { type: string; id: string; property: string; at: number };

declare global {
  interface Window {
    events: PageEvent[];
  }
}

/**
 * Decimal places a computed scale is compared to. Chromium writes a computed
 * transform to six significant digits (1.01333), and a frame moves these
 * squares by at least 0.034, so four places tell one frame from the next
 * many times over.
 */
const PLACES = 4;

/** One frame of the clip, at the test config's 60 fps. */
const oneFrame = (s: RecordingSession): Promise<void> => s.hold(1000 / 60);

/** The page's clock, and the scale a square shows, as of the last frame. */
const sample = (s: RecordingSession, id: string): Promise<Sample> =>
  s.offCamera((page) =>
    page.evaluate((target) => {
      const el = document.getElementById(target);
      if (!el) throw new Error(`the fixture has no #${target}`);
      return {
        now: performance.now(),
        scale: new DOMMatrixReadOnly(getComputedStyle(el).transform).a,
      };
    }, id),
  );

/** `id` sampled on each of the next `count` frames. */
async function framesOf(
  s: RecordingSession,
  id: string,
  count: number,
): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (let k = 0; k < count; k += 1) {
    await oneFrame(s);
    samples.push(await sample(s, id));
  }
  return samples;
}

const eventsOf = (s: RecordingSession, id: string): Promise<PageEvent[]> =>
  s.offCamera((page) =>
    page.evaluate(
      (target) => window.events.filter((event) => event.id === target),
      id,
    ),
  );

const transitionsRunning = (s: RecordingSession): Promise<number> =>
  s.offCamera((page) =>
    page.evaluate(
      () =>
        document.getAnimations().filter((a) => "transitionProperty" in a)
          .length,
    ),
  );

/** Record `body` on the transitions fixture. */
function record(
  browser: Browser,
  id: string,
  body: ClipBody,
  options: { config?: Partial<RecorderConfig>; capture?: CaptureConfig } = {},
) {
  return runClip(
    browser,
    testConfig(options.config),
    clip(id, { title: "Transitions", capture: options.capture }, async (s) => {
      await s.offCamera(installFixtureRoutes);
      await s.open("/transitions.html");
      await body(s);
    }),
  );
}

test.describe("CSS transitions on the clip's clock", () => {
  let browser: Browser;
  test.beforeAll(async () => {
    browser = await launchBrowser();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  test("a transition plays over its duration, a frame at a time", async () => {
    const take = async (id: string, capture?: CaptureConfig) => {
      let samples: Sample[] = [];
      let clickFrame = -1;
      const result = await record(
        browser,
        id,
        async (s) => {
          await s.click(s.byTestId("grow"));
          clickFrame = s.at.frame;
          samples = await framesOf(s, "box", 36);
        },
        { capture },
      );
      return { result, samples, clickFrame };
    };

    const first = await take("transition-scale");
    const { samples, clickFrame } = first;

    // The first frame after the click is where the driver first sees the
    // transition, and its start: it shows the square as it was.
    const start = samples[0].now;
    expect(samples[0].scale).toBe(1);
    // From there the scale is exactly the share of 500 ms the page's clock
    // has moved: linear timing, with nothing of real time in it.
    for (const { now, scale } of samples) {
      expect(scale).toBeCloseTo(1 + Math.min(1, (now - start) / 500), PLACES);
    }
    // In the brief's terms, 1 + k/30 at 60 fps, within what the page's clock
    // runs ahead of authored time (17 ms a frame, not 16.67: Playwright
    // rounds each step up to a whole millisecond).
    samples.forEach(({ scale }, k) => {
      expect(Math.abs(scale - (1 + Math.min(1, k / 30)))).toBeLessThan(0.025);
    });
    expect(samples.at(-1)?.scale).toBe(2);

    // Every frame whose picture changed was photographed: the gate skips
    // nothing while a transition runs.
    const frames = first.result.timeline.frames;
    for (let k = 1; k < samples.length; k += 1) {
      if (samples[k].scale !== samples[k - 1].scale) {
        expect(frames[clickFrame + 1 + k]).not.toBe(frames[clickFrame + k]);
      }
    }

    // And it is the same video every time, and with the gate off.
    const again = await take("transition-scale-again");
    expect(compareRecordings(first.result, again.result).firstDifference).toBe(
      null,
    );
    const ungated = await take("transition-scale-ungated", { gate: false });
    expect(
      compareRecordings(first.result, ungated.result).firstDifference,
    ).toBeNull();
  });

  test("transitionend fires once, when the transition's time is up by the page's clock", async () => {
    let samples: Sample[] = [];
    let events: PageEvent[] = [];
    await record(browser, "transition-end", async (s) => {
      await s.click(s.byTestId("grow"));
      samples = await framesOf(s, "box", 40);
      events = await eventsOf(s, "box");
    });

    const ends = events.filter((e) => e.type === "transitionend");
    expect(ends).toHaveLength(1);
    expect(ends[0].property).toBe("transform");
    // Due on the first frame at or past 500 ms of the transition's own time,
    // and fired then, before the clock moved on: code that waits for it
    // (Leaflet ending a zoom, a dialog unmounting) runs in that frame.
    const start = samples[0].now;
    const due = samples.find((f) => f.now - start >= 500);
    expect(ends[0].at).toBe(due?.now);
    expect(events.filter((e) => e.type === "transitioncancel")).toHaveLength(0);
  });

  test("a delay holds the start, then the transition plays", async () => {
    let samples: Sample[] = [];
    await record(browser, "transition-delay", async (s) => {
      await s.click(s.byTestId("late-button"));
      samples = await framesOf(s, "late", 36);
    });

    const start = samples[0].now;
    for (const { now, scale } of samples) {
      const elapsed = now - start;
      const expected =
        elapsed < 200 ? 1 : 1 + Math.min(1, (elapsed - 200) / 300);
      expect(scale).toBeCloseTo(expected, PLACES);
    }
    expect(samples.filter((f) => f.scale === 1).length).toBeGreaterThan(10);
    expect(samples.at(-1)?.scale).toBe(2);
  });

  test("a transition reversed part way gives way to its reverse, from where it had got to", async () => {
    let forward: Sample[] = [];
    const reverse: Sample[] = [];
    let mostAtOnce = 0;
    let events: PageEvent[] = [];
    await record(browser, "transition-reverse", async (s) => {
      // The keyboard toggles the square without moving the cursor, so the
      // reversal lands on exactly the frame the test chooses.
      await s.offCamera((page) => page.focus("#grow"));
      await s.press("Enter");
      forward = await framesOf(s, "box", 15);
      await s.press("Enter");
      for (let k = 0; k < 30; k += 1) {
        await oneFrame(s);
        reverse.push(await sample(s, "box"));
        mostAtOnce = Math.max(mostAtOnce, await transitionsRunning(s));
      }
      events = await eventsOf(s, "box");
    });

    const reached = forward[14].scale;
    expect(reached).toBeGreaterThan(1.4);
    expect(reached).toBeLessThan(1.6);
    // The browser cancels the first transition and starts a shorter one
    // back, from the value the first had reached. The clock takes the new
    // one from its own start and forgets the cancelled one: never two at
    // once, and no end for the one that was cancelled.
    expect(events.filter((e) => e.type === "transitioncancel")).toHaveLength(1);
    expect(events.filter((e) => e.type === "transitionend")).toHaveLength(1);
    expect(mostAtOnce).toBe(1);
    expect(reverse[0].scale).toBeCloseTo(reached, PLACES);
    for (let k = 1; k < reverse.length; k += 1) {
      expect(reverse[k].scale).toBeLessThanOrEqual(reverse[k - 1].scale);
    }
    // Shortened in proportion to how far the first had got: back within
    // about as long as it took to get there.
    const back = reverse.findIndex((f) => f.scale === 1);
    expect(back).toBeGreaterThan(5);
    expect(back).toBeLessThanOrEqual(16);
  });

  test("a settle waits for a transition that starts inside it", async () => {
    let after: Sample = { now: 0, scale: 0 };
    let events: PageEvent[] = [];
    const result = await record(browser, "transition-settle", async (s) => {
      // The page changes the square 50 ms after the click, on its own timer,
      // so the transition begins while the settle is waiting.
      await s.click(s.byTestId("later"));
      await s.settle({ label: "the square grows" });
      after = await sample(s, "settler");
      events = await eventsOf(s, "settler");
    });

    // The frame after a settle shows the transition finished, as it did when
    // transitions were zeroed, and not at a point that depends on how long
    // the settle happened to take.
    expect(after.scale).toBe(2);
    const ends = events.filter((e) => e.type === "transitionend");
    expect(ends).toHaveLength(1);
    expect(ends[0].at).toBeLessThanOrEqual(after.now);
    const report = result.settles.find((r) => r.label === "the square grows");
    expect(report?.timedOut).toBe(false);
    expect(report?.lastBlocker).toBe("transitions(1)");
  });

  test("an infinite animation is still scrubbed by the clip's time", async () => {
    const seen: { frame: number; angle: number; currentTime: number }[] = [];
    await record(browser, "transition-spinner", async (s) => {
      await s.offCamera((page) =>
        page.evaluate(() => {
          const style = document.createElement("style");
          style.textContent =
            "@keyframes spin { to { transform: rotate(360deg) } } " +
            "#spinner { position: absolute; left: 40px; top: 560px; width: 60px;" +
            " height: 12px; background: #333333; animation: spin 0.8s linear infinite }";
          document.head.appendChild(style);
          const el = document.createElement("div");
          el.id = "spinner";
          document.body.appendChild(el);
        }),
      );
      for (let k = 0; k < 20; k += 1) {
        await oneFrame(s);
        const { frame } = s.at;
        seen.push({
          frame,
          ...(await s.offCamera((page) =>
            page.evaluate(() => {
              const el = document.getElementById("spinner");
              if (!el) throw new Error("no spinner");
              const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
              const spin = document
                .getAnimations()
                .find((a) => "animationName" in a);
              return {
                angle: ((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360,
                currentTime: Number(spin?.currentTime ?? Number.NaN),
              };
            }),
          )),
        });
      }
    });

    // Its turn is the clip's time in seconds over its 0.8 s period, as the
    // scrub has always made it, whatever the transition clock does.
    for (const { frame, angle } of seen) {
      const expected = (360 * (frame / 60 / 0.8)) % 360;
      const off = Math.abs(angle - expected);
      expect(Math.min(off, 360 - off)).toBeLessThan(0.5);
    }
    // And the clock leaves it alone: a paused CSS animation's own time
    // never moves, since the scrub works through its delay.
    expect(new Set(seen.map((f) => f.currentTime)).size).toBe(1);
  });

  test("transition: none is instant, and motion offered to no preference plays", async () => {
    let instant: Sample = { now: 0, scale: 0 };
    let running = -1;
    let safe: Sample[] = [];
    await record(browser, "transition-none", async (s) => {
      await s.click(s.byTestId("instant-button"));
      await oneFrame(s);
      instant = await sample(s, "instant");
      running = await transitionsRunning(s);
      await s.click(s.byTestId("safe-button"));
      safe = await framesOf(s, "safe", 24);
    });

    expect(instant.scale).toBe(2);
    expect(running).toBe(0);
    // The recorder asks for no preference about motion, so an app that
    // offers motion only then shows it: its normal motion design.
    expect(safe[0].scale).toBe(1);
    expect(safe[9].scale).toBeGreaterThan(1.3);
    expect(safe[9].scale).toBeLessThan(1.7);
    expect(safe.at(-1)?.scale).toBe(2);
  });

  test('capture.transitions: "zero" is the old recorder, the change landing at once', async () => {
    const zeroed = async (
      id: string,
      options: { config?: Partial<RecorderConfig>; capture?: CaptureConfig },
    ) => {
      let samples: Sample[] = [];
      let events: PageEvent[] = [];
      let running = -1;
      await record(
        browser,
        id,
        async (s) => {
          await s.click(s.byTestId("grow"));
          samples = await framesOf(s, "box", 4);
          events = await eventsOf(s, "box");
          running = await transitionsRunning(s);
        },
        options,
      );
      return { samples, events, running };
    };

    // From the config.
    const fromConfig = await zeroed("transition-zero", {
      config: { capture: { transitions: "zero" } },
    });
    expect(fromConfig.samples.map((f) => f.scale)).toEqual([2, 2, 2, 2]);
    expect(fromConfig.events).toEqual([]);
    expect(fromConfig.running).toBe(0);

    // From the clip, over the config's default.
    const fromClip = await zeroed("transition-zero-clip", {
      capture: { transitions: "zero" },
    });
    expect(fromClip.samples.map((f) => f.scale)).toEqual([2, 2, 2, 2]);

    // And a clip that plays, in a project that zeroes.
    const playing = await zeroed("transition-play-clip", {
      config: { capture: { transitions: "zero" } },
      capture: { transitions: "play" },
    });
    expect(playing.samples[0].scale).toBe(1);
    expect(playing.samples[3].scale).toBeGreaterThan(1);
    expect(playing.samples[3].scale).toBeLessThan(2);
  });
});
