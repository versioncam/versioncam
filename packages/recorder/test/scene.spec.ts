import { expect, test } from "@playwright/test";
import { launchBrowser } from "../src/driver/launch.js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ffprobeSync } from "../src/render/ffmpeg.js";
import { renderScene } from "../src/render/render.js";
import { loadSceneIds } from "../src/loader.js";
import { FIXTURES, testConfig } from "./support.js";

/**
 * A designed scene, all the way through: the app's TypeScript module bundled
 * for the browser by esbuild, served to the render page over a route, imported
 * there dynamically, and encoded by the same path a recording uses.
 *
 * The route-served dynamic `import()` is the part worth proving — everything
 * else is shared with the recording path.
 */
test.describe("rendering a scene", () => {
  const config = () => testConfig({ scenes: join(FIXTURES, "scenes.ts") });

  test("lists the ids without launching a browser", async () => {
    expect(await loadSceneIds(config())).toEqual(["ramp"]);
  });

  test("encodes the scene's own frame count", async () => {
    const c = config();
    const browser = await launchBrowser();
    try {
      const result = await renderScene(browser, c, "ramp");

      expect(existsSync(result.mp4)).toBe(true);
      expect(result.durationFrames).toBe(60);

      const [frames] = ffprobeSync([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "default=nw=1:nk=1",
        result.mp4,
      ])
        .trim()
        .split("\n");
      expect(Number(frames)).toBe(60);
    } finally {
      await browser.close();
    }
  });

  test("draws a different frame for a different frame number", async () => {
    const c = config();
    const browser = await launchBrowser();
    try {
      const { openRenderPage } = await import("../src/render/render.js");
      const { page } = await openRenderPage(browser, c, {
        kind: "scene",
        id: "ramp",
      });
      const stage = page.locator("#stage");
      const shoot = async (frame: number) => {
        await page.evaluate((n) => window.__render?.setFrame(n), frame);
        return createHash("sha1")
          .update(await stage.screenshot({ type: "png" }))
          .digest("hex");
      };

      const first = await shoot(0);
      const last = await shoot(59);
      expect(first).not.toBe(last);
      // And the same frame twice is the same bytes, as for a recording.
      expect(await shoot(0)).toBe(first);

      await page.context().close();
    } finally {
      await browser.close();
    }
  });

  test("names the scenes it has when asked for one it does not", async () => {
    const c = config();
    const browser = await launchBrowser();
    try {
      await expect(renderScene(browser, c, "nope")).rejects.toThrow(/ramp/);
    } finally {
      await browser.close();
    }
  });

  test("says so when the config names no scenes module at all", async () => {
    // It used to import a bundle that was not there and report a failed
    // fetch, which says nothing about the config.
    const browser = await launchBrowser();
    try {
      await expect(renderScene(browser, testConfig(), "ramp")).rejects.toThrow(
        'No scene called "ramp". The config names no `scenes` module.',
      );
    } finally {
      await browser.close();
    }
  });
});

/**
 * A scenes module whose scenes are not where the renderer reads them: the
 * default export, as a record of scenes by id.
 *
 * Both ways a module is read refuse it, in the same words: listing its ids in
 * Node, which is what `versioncam render` does before it renders anything,
 * and the render page, which is what anything rendering a scene without the
 * CLI reaches. Each used to take the default export and carry on, so a module
 * whose record was a named export had, as far as either could tell, no
 * scenes at all.
 */
test.describe("a scenes module the renderer cannot read", () => {
  const namedOnly = join(FIXTURES, "scenes-named-only.ts");
  const wrongShape = join(FIXTURES, "scenes-wrong-shape.ts");

  const refusal = (listing: Promise<unknown>) =>
    listing.then(
      () => [],
      (error: Error) => error.message.split("\n"),
    );

  test("is refused when it has no default export, naming the file and the fix", async () => {
    expect(
      await refusal(loadSceneIds(testConfig({ scenes: namedOnly }))),
    ).toEqual([
      `${namedOnly} has no default export. It exports SCENES.`,
      expect.stringContaining("a Record<string, Scene> keyed by scene id"),
      "SCENES is one: add `export default SCENES`.",
    ]);
  });

  test("is refused when its default export is the wrong shape", async () => {
    expect(
      await refusal(loadSceneIds(testConfig({ scenes: wrongShape }))),
    ).toEqual([
      `${wrongShape} default-exports an array.`,
      expect.stringContaining("a Record<string, Scene> keyed by scene id"),
    ]);
  });

  test("is refused by the render page too, in the same words", async () => {
    const browser = await launchBrowser();
    try {
      for (const [file, first] of [
        [namedOnly, `${namedOnly} has no default export. It exports SCENES.`],
        [wrongShape, `${wrongShape} default-exports an array.`],
      ]) {
        const error = await renderScene(
          browser,
          testConfig({ scenes: file }),
          "ramp",
        ).then(
          () => null,
          (e: Error) => e,
        );
        expect(error?.message).toContain(first);
        expect(error?.message).toContain(
          "a Record<string, Scene> keyed by scene id",
        );
      }
    } finally {
      await browser.close();
    }
  });
});

declare global {
  interface Window {
    __render?: {
      ready: Promise<void>;
      setFrame: (frame: number) => Promise<void>;
      durationFrames: number;
      fps: number;
    };
  }
}
