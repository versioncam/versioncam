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
