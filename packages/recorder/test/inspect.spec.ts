import { expect, test } from "@playwright/test";
import { chromium } from "playwright";
import { formatInventory, inspectPage } from "../src/inspect/inspect.js";
import { formatMeasurement, measureSelector } from "../src/inspect/measure.js";
import { FIXTURE_ORIGIN, installFixtureRoutes } from "./support.js";

/**
 * The two commands that make writing a clip possible.
 *
 * Both started as throwaway scripts during the prototype, written because
 * every clip authored from source alone reached for something that was not
 * there. They earn their place in the package by being the first thing anyone
 * — a person or an agent — should run before writing a beat.
 */
test.describe("looking at a page", () => {
  test("inventories what a clip can click", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
      });
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/buttons.html`);

      const inventory = await inspectPage(page);

      expect(inventory.viewport).toEqual({ width: 1000, height: 700 });
      const target = inventory.controls.find((c) => c.testId === "target");
      expect(target).toBeDefined();
      expect(target?.role).toBe("button");
      expect(target?.name).toBe("Press me");
      // The fixture's button sits at 400,300 and is 240x80.
      expect(target?.box).toEqual({ x: 400, y: 300, w: 240, h: 80 });
      expect(inventory.testIds).toContain("readout");

      // And it reads as something a person can act on.
      const text = formatInventory(inventory);
      expect(text).toContain("Press me");
      expect(text).toContain("[target]");

      await page.close();
    } finally {
      await browser.close();
    }
  });

  test("measures where the matches of a selector are", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
      });
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/buttons.html`);

      const found = await measureSelector(page, "#target");
      expect(found.count).toBe(1);
      // Centre of the button: 520, 340.
      expect(found.bounds?.x0).toBeCloseTo(520, 0);
      expect(found.bounds?.y0).toBeCloseTo(340, 0);
      // Which is a little past halfway across and halfway down — the form a
      // stroke is authored in.
      expect(found.fractions?.x0).toBeCloseTo(0.52, 2);
      expect(found.fractions?.y0).toBeCloseTo(0.486, 2);
      expect(formatMeasurement(found)).toContain("density");

      // Nothing matching is reported, not thrown: an author needs to know the
      // selector was wrong, and a stack trace does not say that any better.
      const missing = await measureSelector(page, ".no-such-thing");
      expect(missing.count).toBe(0);
      expect(missing.bounds).toBeNull();
      expect(formatMeasurement(missing)).toContain("nothing matched");

      await page.close();
    } finally {
      await browser.close();
    }
  });
});
