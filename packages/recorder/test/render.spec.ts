import { expect, test } from "@playwright/test";
import { launchBrowser } from "../src/driver/launch.js";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { PNG } from "pngjs";
import { fitFrameArea, sourceToOutput } from "../src/core/compose.js";
import { ffprobeSync } from "../src/render/ffmpeg.js";
import { uniformFrames } from "../src/render/sampling.js";
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

  test("with a fixed thread count, encodes the same bytes twice", async () => {
    // What makes a render reproducible: the encoders' output depends on their
    // thread count, which otherwise follows the machine's cores, and the WebM
    // muxer wrote a random id into every file until it was told not to.
    // version.cam's renderer runs with the thread count fixed.
    const hashOf = (file: string) =>
      createHash("sha256").update(readFileSync(file)).digest("hex");
    const renders: string[][] = [];
    const browser = await launchBrowser();
    try {
      for (let run = 0; run < 2; run += 1) {
        const config = testConfig({ output: { width: 480, threads: 2 } });
        expect(config.encoderThreads).toBe(2);
        mkdirSync(config.recordingsDir, { recursive: true });
        cpSync(FIXTURE_RECORDING, join(config.recordingsDir, CLIP), {
          recursive: true,
        });
        const result = await renderRecording(browser, config, CLIP);
        renders.push([hashOf(result.mp4), hashOf(result.webm)]);
      }
    } finally {
      await browser.close();
    }
    expect(renders[1]).toEqual(renders[0]);
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

  test("puts a caption over the app where captionInset says", async () => {
    // An app keeps its own controls in a corner as often as not, and a
    // caption fixed at the bottom left covered them: a sidebar's account
    // menu, a legend a highlight was pointing at.
    const browser = await launchBrowser();
    try {
      const shoot = async (presentation: Presentation | null) => {
        const config = configWith(presentation);
        const target = {
          kind: "recording",
          id: CLIP,
          dir: join(config.recordingsDir, CLIP),
        } as const;
        return PNG.sync.read(await renderFrame(browser, config, target, 40));
      };

      // The first and last columns of the caption's white type. In this
      // band the scrim has darkened the white page to under 210, and the
      // cursor is up at the button, so nothing else here is this bright.
      const type = (png: PNG) => {
        let left = png.width;
        let right = -1;
        for (let y = png.height - 50; y < png.height - 28; y += 1) {
          for (let x = 0; x < png.width; x += 1) {
            if (pixel(png, x, y).every((c) => c > 235)) {
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
        }
        return { left, right };
      };

      // By default, where it always was: 40 pixels in from the left, which
      // is what `{ left: 40 }` says, to the byte.
      const standard = await shoot(null);
      const stated = await shoot({ captionInset: { left: 40 } });
      expect(Buffer.compare(standard.data, stated.data)).toBe(0);
      const before = type(standard);
      expect(before.left).toBeGreaterThanOrEqual(40);
      expect(before.left).toBeLessThan(50);
      expect(before.right).toBeLessThan(standard.width / 2);

      // In the other corner, it ends 40 pixels short of the right edge.
      const moved = await shoot({ captionInset: { right: 40 } });
      const after = type(moved);
      expect(after.right).toBeLessThan(moved.width - 40);
      expect(after.right).toBeGreaterThanOrEqual(moved.width - 50);
      expect(after.left).toBeGreaterThan(moved.width / 2);
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

  test("puts no evenly spread tile inside a dissolve", async () => {
    // The fixture settles once, cut at frame 78, and an even spread of its
    // 115 frames puts the sixth tile on 81: three frames into the six-frame
    // dissolve, where the page before the click ghosts through the page
    // after it. The tile is the first frame past the dissolve instead, the
    // same frame rendered on its own, to the byte.
    const config = configWith(null);
    const browser = await launchBrowser();
    const target = {
      kind: "recording" as const,
      id: CLIP,
      dir: join(config.recordingsDir, CLIP),
    };
    try {
      const timeline = JSON.parse(
        readFileSync(join(target.dir, "timeline.json"), "utf8"),
      ) as { durationFrames: number; cuts: number[] };
      expect(timeline.cuts).toEqual([78]);
      expect(uniformFrames(timeline.durationFrames)[5]).toBe(81);

      await contactSheet(browser, config, target);
      const tile = readFileSync(
        join(config.outputDir, `${CLIP}-sheet`, "05.png"),
      );
      const hash = (png: Buffer) =>
        createHash("sha1").update(png).digest("hex");
      expect(hash(tile)).toBe(
        hash(await renderFrame(browser, config, target, 85)),
      );
    } finally {
      await browser.close();
    }
  });
});

test.describe("a settle whose page did not change", () => {
  test("renders no dissolve, and no dip", async () => {
    // 0.5.0 drew the state at the crossfade's alpha over the backdrop when
    // the state before the cut was the state after it (a menu already open):
    // a sixth of the picture on the frame after the cut, almost black, and
    // back over six frames. Found recording Vpogled's clips.
    const config = configWith(null);
    const dir = join(config.recordingsDir, CLIP);
    const file = join(dir, "timeline.json");
    const timeline = JSON.parse(readFileSync(file, "utf8")) as {
      frames: number[];
      cuts: number[];
    };
    // A cut where the next six frames show the state the cut does.
    const cut = timeline.frames.findIndex(
      (state, frame) =>
        frame > 0 &&
        frame + 6 < timeline.frames.length &&
        !timeline.cuts.some((c) => Math.abs(c - frame) <= 6) &&
        timeline.frames.slice(frame, frame + 7).every((s) => s === state),
    );
    expect(cut).toBeGreaterThan(0);

    // Each frame of what would be the dissolve, as it renders with no cut,
    // then with the cut: the same picture, to the byte.
    const target = { kind: "recording" as const, id: CLIP, dir };
    const hash = (png: Buffer) => createHash("sha1").update(png).digest("hex");
    const browser = await launchBrowser();
    try {
      const window = [1, 2, 3, 4, 5, 6].map((k) => cut + k);
      const without: string[] = [];
      for (const frame of window)
        without.push(hash(await renderFrame(browser, config, target, frame)));
      timeline.cuts = [...timeline.cuts, cut].sort((a, b) => a - b);
      writeFileSync(file, JSON.stringify(timeline));
      for (const [k, frame] of window.entries())
        expect(
          hash(await renderFrame(browser, config, target, frame)),
          `frame ${frame}`,
        ).toBe(without[k]);
    } finally {
      await browser.close();
    }
  });
});

test.describe("the render page", () => {
  test("reaches nothing but its own origin", async () => {
    // version.cam renders customers' recordings with this page, in a
    // container whose runner listens on localhost:8080 and whose one
    // reachable host is the API it calls back. Nothing the page loads may
    // go anywhere but its own routes: a server on this machine stands in
    // for both, and must hear nothing, whether asked by fetch, by markup or
    // by a socket.
    const heard: string[] = [];
    const server = createServer((request, response) => {
      heard.push(`${request.method} ${request.url}`);
      response.writeHead(200, { "access-control-allow-origin": "*" });
      response.end("reached");
    });
    server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
      heard.push(`upgrade ${request.url}`);
      socket.destroy();
    });
    await new Promise<void>((ready) =>
      server.listen(0, "127.0.0.1", () => ready()),
    );
    const { port } = server.address() as AddressInfo;
    const config = configWith(null);
    const browser = await launchBrowser();
    try {
      const { page } = await openRenderPage(browser, config, {
        kind: "recording",
        id: CLIP,
        dir: join(config.recordingsDir, CLIP),
      });
      const failed = new Map<string, string | undefined>();
      page.on("requestfailed", (request) =>
        failed.set(request.url(), request.failure()?.errorText),
      );
      const elsewhere = [
        `http://127.0.0.1:${port}/render`,
        `http://localhost:${port}/healthz`,
        "http://localhost:8080/render",
        "http://api.versioncam.internal/v1/internal/render/job/materials",
      ];
      const outcomes = await page.evaluate(
        async ({ urls, image, socket }) => {
          const fetched = await Promise.all(
            urls.map((url) =>
              fetch(url, { method: "POST", mode: "no-cors", body: "{}" }).then(
                () => "reached",
                () => "refused",
              ),
            ),
          );
          const drawn = await new Promise<string>((resolve) => {
            const img = new Image();
            img.onload = () => resolve("reached");
            img.onerror = () => resolve("refused");
            img.src = image;
          });
          const opened = await new Promise<string>((resolve) => {
            const ws = new WebSocket(socket);
            ws.onopen = () => resolve("reached");
            ws.onclose = () => resolve("refused");
          });
          const own = (await fetch("/render-config.json")).status;
          return { fetched, drawn, opened, own };
        },
        {
          urls: elsewhere,
          image: `http://127.0.0.1:${port}/pixel.png`,
          socket: `ws://127.0.0.1:${port}/`,
        },
      );
      expect(heard).toEqual([]);
      expect(outcomes).toEqual({
        fetched: elsewhere.map(() => "refused"),
        drawn: "refused",
        opened: "refused",
        // Its own origin still answers.
        own: 200,
      });
      // Refused by the page's own routes (Chromium names the DevTools
      // client that blocked it), not by a closed port, a name that does not
      // resolve here or Chromium's local-network check: in the container the
      // port and the name both answer.
      for (const url of [...elsewhere, `http://127.0.0.1:${port}/pixel.png`]) {
        expect(failed.get(url), url).toMatch(/^net::ERR_BLOCKED_BY_CLIENT\b/);
      }
      await page.context().close();
    } finally {
      await browser.close();
      await new Promise((closed) => server.close(closed));
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
