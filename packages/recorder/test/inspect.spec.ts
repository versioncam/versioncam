import { expect, test } from "@playwright/test";
import { launchBrowser } from "../src/driver/launch.js";
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
    const browser = await launchBrowser();
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
      expect(text).toContain("Press me [text]  [target]");

      await page.close();
    } finally {
      await browser.close();
    }
  });

  test("gives a field the geometry it gives a control", async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
      });
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/fields.html`);

      const inventory = await inspectPage(page);
      const recipient = inventory.fields.find((f) => f.testId === "recipient");
      expect(recipient?.kind).toBe("input");
      expect(recipient?.name).toBe("Recipient");
      expect(recipient?.box).toEqual({ x: 40, y: 40, w: 300, h: 36 });

      // A field is a click target before it is a typing target, so the text
      // form has to say where it is — it used to print the name alone, which
      // is no help at all when two inputs are named alike.
      const text = formatInventory(inventory);
      expect(text).toContain(
        "Recipient [aria-label]  [recipient]  @ 40,40 300x36",
      );
      expect(text).toContain("Notes [placeholder]  [notes]  @ 40,120 300x80");
      expect(text).toContain("Route [aria-label]  [route]  @ 40,240 200x32");

      await page.close();
    } finally {
      await browser.close();
    }
  });

  test("says where every name came from, which is which locator finds it", async () => {
    // Two fields can print the same name and need different locators:
    // `byLabel` finds an aria-label or a <label>, not a placeholder. An agent
    // that could not tell which it had spent a recording finding out.
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
      });
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/fields.html`);

      const { fields, controls } = await inspectPage(page);
      const field = (testId: string) => fields.find((f) => f.testId === testId);
      expect(field("recipient")).toMatchObject({
        name: "Recipient",
        nameSource: "aria-label",
      });
      expect(field("city")).toMatchObject({
        name: "City",
        nameSource: "label",
      });
      // A label that wraps its select reads its own words, not the options.
      expect(field("speed")).toMatchObject({
        name: "Speed",
        nameSource: "label",
      });
      expect(field("notes")).toMatchObject({
        name: "Notes",
        nameSource: "placeholder",
      });
      expect(field("reference")).toMatchObject({
        name: "reference",
        nameSource: "name",
      });
      expect(controls.find((c) => c.testId === "close")).toMatchObject({
        name: "Close dialog",
        nameSource: "aria-label",
      });

      await page.close();
    } finally {
      await browser.close();
    }
  });

  test("prints a readable number of controls, and says what it left out", async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
      });
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/crowded.html`);

      const inventory = await inspectPage(page);
      expect(inventory.controls).toHaveLength(72);

      const text = formatInventory(inventory);
      // The header keeps the real count, the body is trimmed, and the gap is
      // stated: a page with hundreds of controls must not fill the reader.
      expect(text).toContain("controls (72):");
      expect(text).toContain("M59");
      expect(text).not.toContain("M60");
      expect(text).toContain("… 12 more not shown");

      // The data behind it is whole; only the reading form is trimmed.
      expect(inventory.controls.at(-1)?.name).toBe("M71");

      await page.close();
    } finally {
      await browser.close();
    }
  });

  test("measures where the matches of a selector are", async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
      });
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/buttons.html`);

      const found = await measureSelector(page, "#target");
      expect(found.count).toBe(1);
      // The button's own box: 400,300, 240x80. Measured over centres, as it
      // was, one match collapsed to the point 520,340 — bounds of zero size,
      // from which no framing can be planned.
      expect(found.boxes).toEqual([{ x: 400, y: 300, w: 240, h: 80 }]);
      expect(found.bounds).toEqual({ x0: 400, y0: 300, x1: 640, y1: 380 });
      // And as fractions, which is the form a stroke is authored in.
      expect(found.fractions?.x0).toBeCloseTo(0.4, 2);
      expect(found.fractions?.y0).toBeCloseTo(0.4286, 3);
      expect(formatMeasurement(found)).toContain("@ 400,300 240x80");
      // And what it says, so a beat's `expect` can quote the screen.
      expect(found.texts).toEqual(["Press me"]);
      expect(formatMeasurement(found)).toContain('text="Press me"');

      // Nothing matching is reported, not thrown: an author needs to know the
      // selector was wrong, and a stack trace does not say that any better.
      const missing = await measureSelector(page, ".no-such-thing");
      expect(missing.count).toBe(0);
      expect(missing.boxes).toEqual([]);
      expect(missing.bounds).toBeNull();
      expect(formatMeasurement(missing)).toContain("nothing matched");

      await page.close();
    } finally {
      await browser.close();
    }
  });

  test("reads a status line as it is rendered", async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
      });
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/fields.html`);

      // Markup across three lines and a span; one line of text on screen.
      const status = await measureSelector(page, '[data-testid="status"]');
      expect(status.texts).toEqual(["1 of 12 shipments match"]);
      expect(formatMeasurement(status)).toContain(
        'text="1 of 12 shipments match"',
      );

      await page.close();
    } finally {
      await browser.close();
    }
  });

  test("falls back to density when there are too many to list", async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 700 },
      });
      await installFixtureRoutes(page);
      await page.goto(`${FIXTURE_ORIGIN}/crowded.html`);

      const found = await measureSelector(page, ".marker");
      expect(found.count).toBe(72);
      // Seventy-two boxes is a wall of numbers, so the answer reverts to the
      // shape of the cluster — bounds that enclose every box, plus the grid.
      expect(found.boxes).toEqual([]);
      expect(found.bounds).toEqual({ x0: 40, y0: 40, x1: 860, y1: 520 });
      const text = formatMeasurement(found);
      expect(text).toContain("density");
      expect(text).not.toContain("boxes:");
      expect(found.grid.flat().reduce((a, b) => a + b, 0)).toBe(72);

      await page.close();
    } finally {
      await browser.close();
    }
  });
});
