import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { launchBrowser } from "../src/driver/launch.js";
import { clip, runClip } from "../src/driver/clip.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * A clip that reaches for something the app does not have must fail by saying
 * so.
 *
 * This is not a nicety. In the prototype a locator wait was unbounded, so a
 * clip written against a control that had been renamed — or, once, one that
 * was never rendered at all — hung indefinitely and surfaced later as an
 * inscrutable timeout with no indication of which step was at fault. An
 * authoring loop cannot repair what it cannot read.
 */
test("a missing locator fails by name, with the step and the moment", async () => {
  test.setTimeout(90_000);
  const browser = await launchBrowser();
  try {
    const config = testConfig();
    const failing = clip(
      "missing-control",
      { title: "Missing", viewport: { width: 1000, height: 700 }, seed: 1 },
      async (s: RecordingSession) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/buttons.html");
        await s.hold(200);
        await s.click(s.byTestId("no-such-control"));
      },
    );

    const error = await runClip(browser, config, failing).then(
      () => null,
      (e: Error) => e,
    );

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Nothing matched");
    expect(error?.message).toContain("no-such-control");
    // And where it gave up, so a repair knows which beat to look at.
    expect(error?.message).toMatch(/frame \d+/);

    // The evidence outlives the browser. The context closes as this returns,
    // and a message alone cannot say whether the control was absent, covered,
    // scrolled away or never reached — so the page as it stood is written out
    // before anything is torn down.
    const dir = join(config.recordingsDir, "missing-control");
    const failure = JSON.parse(
      readFileSync(join(dir, "failure.json"), "utf8"),
    ) as { message: string; frame: number; t: number };
    expect(failure.message).toBe(error?.message);
    expect(failure.frame).toBeGreaterThanOrEqual(0);
    expect(failure.t).toBeGreaterThan(0);

    // A real picture of the page, at the scale this recording captures in.
    const shot = PNG.sync.read(readFileSync(join(dir, "failure.png")));
    expect(shot.width).toBe(config.viewport.width * config.dpr);
    expect(shot.height).toBe(config.viewport.height * config.dpr);

    // And the waits that did work, which is how a timeout gets diagnosed.
    expect(existsSync(join(dir, "settles.json"))).toBe(true);
  } finally {
    await browser.close();
  }
});

/**
 * The other locator failure, which used to be reported as this one.
 *
 * A pilot's `byText("Nairobi")` matched a table cell and a status line, and
 * Playwright's strict-mode violation reached the author as "Nothing matched" —
 * so it went looking for a control that had been on screen all along. The two
 * failures call for opposite repairs and must therefore read differently.
 */
test("a locator matching several elements says so, and how to narrow it", async () => {
  test.setTimeout(90_000);
  const browser = await launchBrowser();
  try {
    const ambiguous = clip(
      "ambiguous-text",
      { title: "Ambiguous", viewport: { width: 1000, height: 700 }, seed: 1 },
      async (s: RecordingSession) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/duplicate-text.html");
        await s.hold(200);
        await s.click(s.byText("Nairobi"));
      },
    );

    const error = await runClip(browser, testConfig(), ambiguous).then(
      () => null,
      (e: Error) => e,
    );

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Matched 2 elements");
    expect(error?.message).not.toContain("Nothing matched");
    // The remedy, named: without it the count alone reads as a page problem.
    expect(error?.message).toContain("byRole");
    expect(error?.message).toContain("test id");
    expect(error?.message).toMatch(/frame \d+/);
  } finally {
    await browser.close();
  }
});
