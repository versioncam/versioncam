import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { clip, runClip } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * A dev server's own tools stay out of the video, and errors stay in the open.
 *
 * `next dev`, `nuxt dev` and `astro dev` draw over the app, on a clock of their
 * own, so a stranger's first clip was marked and unstable. Next's error dialog is
 * in the same closed shadow root as its badge and goes with it, which is the one
 * thing here that could make a video quietly wrong, so these tests hold both ends.
 */

const VIEWPORT = { width: 1000, height: 700 };
const TOOLS = [
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
  "#ff8000",
  "#8000ff",
];

/** Which of the fixture's tools, each 60 px square along the bottom, are drawn. */
function drawn(file: string, dpr: number): string[] {
  const png = PNG.sync.read(readFileSync(file));
  return TOOLS.filter((_, i) => {
    const x = (80 * i + 30) * dpr;
    const y = (VIEWPORT.height - 30) * dpr;
    const at = (png.width * y + x) * 4;
    const hex = [png.data[at], png.data[at + 1], png.data[at + 2]]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}` === TOOLS[i];
  });
}

test("the tools of Next, Nuxt, Astro, Vercel and Netlify are in no frame", async () => {
  const browser = await launchBrowser();
  try {
    const result = await runClip(
      browser,
      testConfig({ viewport: VIEWPORT }),
      clip("tools", { title: "Tools" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/dev-tools.html");
        await s.hold(100);
      }),
    );
    for (const name of result.timeline.states) {
      expect(drawn(join(result.dir, "states", name), 2)).toEqual([]);
    }
  } finally {
    await browser.close();
  }
});

test("a failed clip leaves a second picture with them showing", async () => {
  // A build error in Next's overlay leaves the app blank and every control gone.
  // The first picture stays the page as it stood: the second is a moment later.
  const browser = await launchBrowser();
  try {
    const config = testConfig({ viewport: VIEWPORT });
    await expect(
      runClip(
        browser,
        config,
        clip("tools-failed", { title: "Tools" }, async (s) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/dev-tools.html");
          throw new Error("the clip gave up");
        }),
      ),
    ).rejects.toThrow("the clip gave up");
    const dir = join(config.recordingsDir, "tools-failed");
    expect(drawn(join(dir, "failure.png"), 2)).toEqual([]);
    expect(drawn(join(dir, "failure-tools.png"), 2)).toEqual(TOOLS);
  } finally {
    await browser.close();
  }
});

test("a page with no such tools leaves the one picture, as it stood", async () => {
  const browser = await launchBrowser();
  try {
    const config = testConfig({ viewport: VIEWPORT });
    await expect(
      runClip(
        browser,
        config,
        clip("no-tools", { title: "No tools" }, async (s) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/buttons.html");
          throw new Error("the clip gave up");
        }),
      ),
    ).rejects.toThrow("the clip gave up");
    const dir = join(config.recordingsDir, "no-tools");
    expect(existsSync(join(dir, "failure.png"))).toBe(true);
    expect(existsSync(join(dir, "failure-tools.png"))).toBe(false);
  } finally {
    await browser.close();
  }
});

test("what the page threw is said, on a clip that goes on", async () => {
  const browser = await launchBrowser();
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args.join(" "));
  try {
    await runClip(
      browser,
      testConfig({ viewport: VIEWPORT }),
      clip("tools-threw", { title: "Tools" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/dev-tools.html");
        await s.click(s.byTestId("throw"));
        await s.hold(100);
      }),
    );
    expect(warned.join("\n")).toContain('The page threw during "tools-threw"');
    expect(warned.join("\n")).toContain("boom in a handler");
  } finally {
    console.warn = warn;
    await browser.close();
  }
});

test("what the page threw stands beside the failure of a clip that does not", async () => {
  const browser = await launchBrowser();
  try {
    await expect(
      runClip(
        browser,
        testConfig({ viewport: VIEWPORT }),
        clip("tools-threw-failed", { title: "Tools" }, async (s) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/dev-tools.html");
          await s.click(s.byTestId("throw"));
          await s.settle({ label: "thrown" });
          throw new Error("the clip gave up");
        }),
      ),
    ).rejects.toThrow(/the clip gave up[\s\S]*boom in a handler/);
  } finally {
    await browser.close();
  }
});
