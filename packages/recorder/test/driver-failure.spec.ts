import { expect, test } from "@playwright/test";
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

    const error = await runClip(browser, testConfig(), failing).then(
      () => null,
      (e: Error) => e,
    );

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Nothing matched");
    expect(error?.message).toContain("no-such-control");
    // And where it gave up, so a repair knows which beat to look at.
    expect(error?.message).toMatch(/frame \d+/);
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
