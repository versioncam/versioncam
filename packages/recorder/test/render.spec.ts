import { expect, test } from "@playwright/test";
import { launchBrowser } from "../src/driver/launch.js";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { fitFrameArea, sourceToOutput } from "../src/core/compose.js";
import { ffprobeSync } from "../src/render/ffmpeg.js";
import {
  contactSheet,
  openRenderPage,
  readTimeline,
  renderFrame,
  renderRecording,
} from "../src/render/render.js";
import type { ResolvedConfig, Presentation } from "../src/config.js";
import { FIXTURE_RECORDING, testConfig } from "./support.js";

/**
 * Renders the checked-in fixture recording end to end: canvas, camera, cursor,
 * ripple, crossfade, caption, then both encoders.
 *
 * The recording is committed rather than produced by the driver so that a
 * renderer regression cannot be masked by a driver regression, and so this
 * suite runs without a browser ever touching an app.
 */

const CLIP = "recording-buttons";
const VIEWPORT = { width: 1000, height: 700 };

/** A config whose recordings directory already contains the fixture. */
function configWith(presentation: Presentation | null): ResolvedConfig {
  const config = testConfig(presentation ? { theme: { presentation } } : {});
  mkdirSync(config.recordingsDir, { recursive: true });
  cpSync(FIXTURE_RECORDING, join(config.recordingsDir, CLIP), {
    recursive: true,
  });
  return config;
}

function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const i = (png.width * Math.round(y) + Math.round(x)) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

test.describe("rendering a recording", () => {
  test("encodes exactly the authored frames at the viewport's aspect", async () => {
    const config = configWith(null);
    const browser = await launchBrowser();
    try {
      const result = await renderRecording(browser, config, CLIP);

      expect(existsSync(result.mp4)).toBe(true);
      expect(existsSync(result.webm)).toBe(true);
      expect(existsSync(result.poster)).toBe(true);
      expect(statSync(result.mp4).size).toBeGreaterThan(10_000);
      expect(statSync(result.webm).size).toBeGreaterThan(10_000);
      expect(existsSync(result.sheet)).toBe(true);

      // A dropped or duplicated frame is the classic real-time-capture
      // failure, and the whole point of the stepped design is that it cannot
      // happen. 1000x700 captured becomes 1920x1344 out: the aspect follows
      // the viewport, so nothing is letterboxed or cropped.
      const [width, height, rate, frames] = ffprobeSync([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=nb_read_frames,width,height,r_frame_rate",
        "-of",
        "default=nw=1:nk=1",
        result.mp4,
      ])
        .trim()
        .split("\n");

      expect(Number(width)).toBe(1920);
      expect(Number(height)).toBe(1344);
      expect(rate).toBe(`${result.fps}/1`);
      expect(Number(frames)).toBe(result.durationFrames);

      const poster = PNG.sync.read(readFileSync(result.poster));
      expect(poster.width).toBe(1920);
      expect(poster.height).toBe(1344);
    } finally {
      await browser.close();
    }
  });

  test("is a pure function of the frame number", async () => {
    const config = configWith(null);
    const browser = await launchBrowser();

    const shoot = async (frames: number[]) => {
      const { page } = await openRenderPage(browser, config, {
        kind: "recording",
        id: CLIP,
        dir: join(config.recordingsDir, CLIP),
      });
      const stage = page.locator("#stage");
      const hashes: string[] = [];
      for (const frame of frames) {
        await page.evaluate((n) => window.__render?.setFrame(n), frame);
        hashes.push(
          createHash("sha1")
            .update(await stage.screenshot({ type: "png" }))
            .digest("hex"),
        );
      }
      await page.context().close();
      return hashes;
    };

    try {
      // Same frames, different orders, separate pages. If any of these differ,
      // something time-dependent leaked into the draw path and every clip
      // rendered afterwards would be subtly irreproducible.
      const forwards = await shoot([10, 40, 70, 100]);
      const backwards = await shoot([100, 70, 40, 10]);
      expect(backwards.reverse()).toEqual(forwards);

      // And different frames really are different — otherwise the assertion
      // above would pass on a renderer that drew nothing at all.
      expect(new Set(forwards).size).toBe(forwards.length);
    } finally {
      await browser.close();
    }
  });

  test("with no presentation, the app fills the canvas", async () => {
    const config = configWith(null);
    const browser = await launchBrowser();
    try {
      const { page } = await openRenderPage(browser, config, {
        kind: "recording",
        id: CLIP,
        dir: join(config.recordingsDir, CLIP),
      });
      await page.evaluate(() => window.__render?.setFrame(0));
      const png = PNG.sync.read(
        await page.locator("#stage").screenshot({ type: "png" }),
      );

      // Corner to corner is the fixture page, which is white. No backdrop, no
      // inset, nothing invented to fill an aspect mismatch.
      expect(pixel(png, 2, 2)).toEqual([255, 255, 255]);
      expect(pixel(png, png.width - 3, 2)).toEqual([255, 255, 255]);

      // And the app is drawn where the compositing maths says: the fixture's
      // viewport centre falls inside its blue button.
      expect(pixel(png, png.width / 2, png.height / 2)).toEqual([0, 0, 255]);

      await page.context().close();
    } finally {
      await browser.close();
    }
  });

  test("with presentation, the app is inset on a backdrop", async () => {
    const config = configWith({
      backdrop: ["#1a0b33", "#3c1087"],
      frame: true,
      padding: 0.045,
      caption: "below",
    });
    const browser = await launchBrowser();
    try {
      const { page } = await openRenderPage(browser, config, {
        kind: "recording",
        id: CLIP,
        dir: join(config.recordingsDir, CLIP),
      });
      await page.evaluate(() => window.__render?.setFrame(0));
      const png = PNG.sync.read(
        await page.locator("#stage").screenshot({ type: "png" }),
      );

      // The corner is now backdrop: a purple gradient, so blue dominates red.
      const corner = pixel(png, 4, 4);
      expect(corner[2]).toBeGreaterThan(corner[0]);
      expect(corner[2]).toBeGreaterThan(40);

      // A known-white point of the fixture page, mapped through the same
      // maths the renderer used. If the two ever disagree, that is the bug
      // worth catching.
      const canvas = { width: png.width, height: png.height };
      const frameArea = fitFrameArea(canvas, VIEWPORT, 0.045);
      const camera = { x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height };
      const [wx, wy] = sourceToOutput([40, 40], camera, frameArea);
      expect(pixel(png, wx, wy)).toEqual([255, 255, 255]);

      await page.context().close();
    } finally {
      await browser.close();
    }
  });

  test("draws the caption, and only once it has faded in", async () => {
    const config = configWith(null);
    const browser = await launchBrowser();
    try {
      const { page } = await openRenderPage(browser, config, {
        kind: "recording",
        id: CLIP,
        dir: join(config.recordingsDir, CLIP),
      });
      const stage = page.locator("#stage");

      // With no presentation the caption sits over the app on a dark scrim,
      // and the fixture page behind it is white — so the signal is darkness
      // appearing, not brightness. Counting bright pixels here would count
      // the page.
      const darkPixels = (png: PNG) => {
        let dark = 0;
        for (let x = 30; x < 500; x += 1) {
          for (let y = png.height - 60; y < png.height - 10; y += 1) {
            const [r, g, b] = pixel(png, x, y);
            if (r < 160 && g < 160 && b < 160) dark += 1;
          }
        }
        return dark;
      };

      // The caption fades in from t=0, so at frame 0 it is correctly absent
      // and the band is the page's own white.
      await page.evaluate(() => window.__render?.setFrame(0));
      expect(
        darkPixels(PNG.sync.read(await stage.screenshot({ type: "png" }))),
      ).toBe(0);

      await page.evaluate(() => window.__render?.setFrame(40));
      expect(
        darkPixels(PNG.sync.read(await stage.screenshot({ type: "png" }))),
      ).toBeGreaterThan(2000);

      await page.context().close();
    } finally {
      await browser.close();
    }
  });

  test("renders a single frame at output size", async () => {
    const config = configWith(null);
    const browser = await launchBrowser();
    try {
      const target = {
        kind: "recording",
        id: CLIP,
        dir: join(config.recordingsDir, CLIP),
      } as const;
      const timeline = await readTimeline(config, CLIP);
      const last = timeline.durationFrames - 1;

      const opening = PNG.sync.read(
        await renderFrame(browser, config, target, 0),
      );
      const closing = PNG.sync.read(
        await renderFrame(browser, config, target, last),
      );

      // The frame that would be in the video, not a thumbnail of it: this is
      // what a reviewer looks at when a contact sheet tile is too small to
      // settle whether a caption is legible.
      expect(opening.width).toBe(config.output.width);
      expect(opening.height).toBe(config.output.height);
      expect(closing.width).toBe(config.output.width);

      // Different frames, and not by accident: at frame 0 the caption has not
      // faded in and the button has not been pressed.
      expect(Buffer.compare(opening.data, closing.data)).not.toBe(0);

      // A frame the clip does not have is refused by saying what it does have.
      const beyond = await renderFrame(
        browser,
        config,
        target,
        timeline.durationFrames,
      ).then(
        () => null,
        (e: Error) => e,
      );
      expect(beyond?.message).toContain(`0–${last}`);
    } finally {
      await browser.close();
    }
  });

  test("writes a contact sheet for review", async () => {
    const config = configWith(null);
    const browser = await launchBrowser();
    try {
      const sheet = await contactSheet(browser, config, {
        kind: "recording",
        id: CLIP,
        dir: join(config.recordingsDir, CLIP),
      });
      expect(existsSync(sheet)).toBe(true);
      expect(statSync(sheet).size).toBeGreaterThan(10_000);
      expect(sheet.startsWith(config.outputDir)).toBe(true);
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
