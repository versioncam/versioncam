import { expect, test } from "@playwright/test";
import { setTimeout as sleep } from "node:timers/promises";
import { compareRecordings } from "../src/driver/compare.js";
import { clip, runClip } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * The page's clock moves when the driver moves it, and at no other time.
 *
 * Playwright's fake clock, merely installed, keeps running on real time
 * between the driver's own steps. Every screenshot and every stall of the
 * machine then reached the page as time, and on the Linux runner a single slow
 * frame moved the example app's clock by 840 ms instead of 67, so its 800 ms
 * timer fired seven frames early in one run of two. Nothing about the fixture
 * pages is slow, so these tests make real time pass on purpose.
 */

const pageNow = (s: RecordingSession): Promise<number> =>
  s.offCamera((page) => page.evaluate(() => performance.now()));

test("real time between frames never reaches the page's clock", async () => {
  const browser = await launchBrowser();
  try {
    let elapsed = 0;
    await runClip(
      browser,
      testConfig(),
      clip("clock-still", { title: "Clock" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/buttons.html");
        const before = await pageNow(s);
        // Real time the script does not author: what a slow screenshot or a
        // busy machine costs.
        await s.offCamera(() => sleep(400));
        await s.hold(500);
        elapsed = (await pageNow(s)) - before;
      }),
    );
    // Half a second of frames, and nothing of the 400 ms spent outside them.
    // Each frame's step is rounded up to a whole millisecond, which is the
    // slack above the half second.
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(500 + 2 * (1000 / 60));
  } finally {
    await browser.close();
  }
});

test("a target the app shows from its own timer arrives in page time", async () => {
  // The clock being paused must not strand a clip that reaches for something
  // the app puts up a moment later: the driver ticks the clock while it waits,
  // as a settle does, so the control arrives — and on the same tick every run.
  const browser = await launchBrowser();
  try {
    const clickedAt: number[] = [];
    const record = (id: string) =>
      runClip(
        browser,
        testConfig(),
        clip(id, { title: "Late" }, async (s) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/late.html");
          await s.click(s.byTestId("late"));
          await s.hold(200);
          clickedAt.push(
            Number(
              await s.offCamera((page) =>
                page.evaluate(() => document.body.dataset.clickedAt),
              ),
            ),
          );
        }),
      );

    const first = await record("clock-late");
    const second = await record("clock-late-again");

    expect(clickedAt[0]).toBeGreaterThanOrEqual(300);
    expect(clickedAt[1]).toBe(clickedAt[0]);
    expect(second.timeline.frames).toEqual(first.timeline.frames);
    expect(compareRecordings(first, second).firstDifference).toBeNull();
  } finally {
    await browser.close();
  }
});
