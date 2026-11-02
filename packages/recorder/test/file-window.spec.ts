import { expect, test } from "@playwright/test";
import type { Browser } from "playwright";
import { compareRecordings } from "../src/driver/compare.js";
import { clip, runClip } from "../src/driver/clip.js";
import type { ClipBody } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * `fileWindow`: a drawn file window whose drop lands on a real dropzone,
 * through the events a real drag sends, with the files' names, types and
 * contents.
 */

const FILES = [
  { name: "cases.csv", content: "id,site\n1,Jakarta\n" },
  { name: "sites.csv", content: "site,lat\nJakarta,-6.2\n" },
  { name: "notes.txt", content: "three" },
];

function record(browser: Browser, id: string, body: ClipBody) {
  return runClip(
    browser,
    testConfig(),
    clip(id, { title: "File window" }, async (s) => {
      await s.offCamera(installFixtureRoutes);
      await s.open("/dropzone.html");
      await body(s);
    }),
  );
}

const dropped = (s: RecordingSession): Promise<string[]> =>
  s.offCamera((page) =>
    page
      .getByTestId("files")
      .evaluate((list) =>
        [...list.children].map((line) => line.textContent ?? ""),
      ),
  );

const windowOpen = (s: RecordingSession): Promise<boolean> =>
  s.offCamera((page) =>
    page.evaluate(() => document.getElementById("vc-file-window") !== null),
  );

test.describe("fileWindow", () => {
  let browser: Browser;
  test.beforeAll(async () => {
    browser = await launchBrowser();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  const selectTwoAndDrop: ClipBody = async (s) => {
    const files = await s.fileWindow(FILES, { title: "Case data" });
    await s.click(files.item(0));
    await s.click(files.item(1), { modifiers: ["Shift"] });
    await s.drag(files.item(0), s.byTestId("zone"), { duration: 800 });
    await s.settle({ label: "dropped" });
    await s.hold(400);
  };

  test("drops the selected files on the page's dropzone, with their contents", async () => {
    let result: string[] = [];
    let open = true;
    await record(browser, "file-window-drop", async (s) => {
      await selectTwoAndDrop(s);
      result = await dropped(s);
      open = await windowOpen(s);
    });
    expect(result).toEqual([
      "cases.csv (text/csv): id,site\n1,Jakarta\n",
      "sites.csv (text/csv): site,lat\nJakarta,-6.2\n",
    ]);
    // The window goes with the files.
    expect(open).toBe(false);
  });

  test("adds and removes a row with Meta, and drags one row on its own", async () => {
    let result: string[] = [];
    await record(browser, "file-window-meta", async (s) => {
      const files = await s.fileWindow(FILES);
      await s.click(files.item(0));
      await s.click(files.item(2), { modifiers: ["Meta"] });
      await s.click(files.item(0), { modifiers: ["Meta"] });
      await s.drag(files.item(2), s.byTestId("zone"), { duration: 600 });
      await s.settle();
      result = await dropped(s);
    });
    expect(result).toEqual(["notes.txt (text/plain): three"]);
  });

  test("closes without dropping when told", async () => {
    let open = true;
    await record(browser, "file-window-close", async (s) => {
      const files = await s.fileWindow(FILES);
      await files.close();
      open = await windowOpen(s);
    });
    expect(open).toBe(false);
  });

  test("records the same bytes twice", async () => {
    const first = await record(browser, "file-window-a", selectTwoAndDrop);
    const second = await record(browser, "file-window-b", selectTwoAndDrop);
    expect(compareRecordings(first, second).firstDifference).toBeNull();
  });
});

test("drag goes from one thing to another", async () => {
  const browser = await launchBrowser();
  try {
    let presses: string[] = [];
    await record(browser, "drag-between", async (s) => {
      await s.drag(s.byTestId("a"), s.byTestId("b"), { duration: 500 });
      presses = await s.offCamera((page) =>
        page.evaluate(
          () => (window as unknown as { presses: string[] }).presses,
        ),
      );
    });
    expect(presses).toEqual(["down a", "up b"]);
  } finally {
    await browser.close();
  }
});
