import { expect, test } from "@playwright/test";
import { launchBrowser } from "../src/driver/launch.js";
import {
  FRAME_PROBE,
  FREEZE_CSS_SCRIPT,
  MUTATION_COUNTER_SCRIPT,
} from "../src/driver/page-hooks.js";
import type { FrameProbe } from "../src/driver/page-hooks.js";
import { FIXTURE_ORIGIN, installFixtureRoutes } from "./support.js";

/**
 * The per-frame probe, which the capture gate is built on.
 *
 * Every assertion here is load-bearing for the gate: if the counter moves on
 * its own the gate never skips, and if it fails to move when the page really
 * changed the gate skips a frame it should have kept — which is a wrong video
 * rather than a slow one.
 */
test.describe("the frame probe", () => {
  test("a scrub does not register as a change, and anything else does", async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.addInitScript(MUTATION_COUNTER_SCRIPT);
      await page.addInitScript(FREEZE_CSS_SCRIPT);
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/buttons.html`);

      const probe = (t: number) =>
        page.evaluate<FrameProbe>(FRAME_PROBE(t, 10, 10));

      const before = (await probe(0)).mutations;
      // A hundred frames' worth of scrubbing, which is what a two-second clip
      // does. The driver writes this attribute on every frame, so if it
      // counted, the counter would never hold still and the gate would never
      // skip anything.
      for (let i = 1; i <= 100; i += 1) await probe(i / 60);
      expect((await probe(2)).mutations).toBe(before);

      // The same attribute, written by the page rather than by the recorder.
      await page.evaluate(() =>
        document.documentElement.style.setProperty("color-scheme", "dark"),
      );
      expect((await probe(2)).mutations).toBeGreaterThan(before);

      const afterStyle = (await probe(2)).mutations;
      await page.evaluate(() =>
        document.body.appendChild(document.createElement("span")),
      );
      expect((await probe(2)).mutations).toBeGreaterThan(afterStyle);
    } finally {
      await browser.close();
    }
  });

  test("reports what is under the cursor, and what is animating", async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.addInitScript(MUTATION_COUNTER_SCRIPT);
      await page.addInitScript(FREEZE_CSS_SCRIPT);
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/buttons.html`);

      const box = await page.getByTestId("target").boundingBox();
      if (!box) throw new Error("the fixture's target has no box");
      const onTarget = await page.evaluate<FrameProbe>(
        FRAME_PROBE(0, box.x + box.width / 2, box.y + box.height / 2),
      );
      const elsewhere = await page.evaluate<FrameProbe>(FRAME_PROBE(0, 2, 2));

      expect(onTarget.hovered).not.toBe(0);
      expect(onTarget.hovered).not.toBe(elsewhere.hovered);
      // Stable: the same element under the pointer reads as the same identity,
      // or every frame would look like a change and nothing would be skipped.
      const again = await page.evaluate<FrameProbe>(
        FRAME_PROBE(0.5, box.x + box.width / 2, box.y + box.height / 2),
      );
      expect(again.hovered).toBe(onTarget.hovered);

      // Nothing on the fixture animates; an element that does is visible to
      // the probe, which is what stops the gate from freezing a spinner.
      expect(onTarget.animations).toBe(0);
      await page.evaluate(() => {
        const style = document.createElement("style");
        style.textContent =
          "@keyframes spin { to { transform: rotate(360deg) } } " +
          ".spins { animation: spin 0.8s linear infinite }";
        document.head.appendChild(style);
        const el = document.createElement("div");
        el.className = "spins";
        document.body.appendChild(el);
      });
      expect(
        (await page.evaluate<FrameProbe>(FRAME_PROBE(0.5, 2, 2))).animations,
      ).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  });
});
