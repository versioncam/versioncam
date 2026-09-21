import { expect, test } from "@playwright/test";
import { launchBrowser } from "../src/driver/launch.js";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";
import { PNG } from "pngjs";
import { clip, runClip } from "../src/driver/clip.js";
import type { ClipDefinition } from "../src/driver/clip.js";
import type { RecordingSession } from "../src/driver/session.js";
import type { ResolvedConfig } from "../src/config.js";
import type { Rect, Timeline } from "../src/core/timeline.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * Proves the three claims the whole recorder rests on, against a static
 * fixture page served from a route table — so it needs no app, no backend and
 * no credentials:
 *
 *  1. one captured image per output frame, at the authored frame count;
 *  2. the real page really is in the state the timeline says (hover and press
 *     are CSS states no synthetic overlay could fake);
 *  3. a second run produces the same bytes.
 */

// 2s at 60fps: long enough for an approach, a hover, a press and a release.
async function fixtureBody(s: RecordingSession): Promise<void> {
  // The same seam an app uses to mock its own API: routes go on the page the
  // driver made, before anything navigates.
  await s.offCamera(installFixtureRoutes);
  await s.open("/buttons.html");
  s.caption("Recorder fixture");
  await s.hold(300);
  await s.hover(s.byTestId("target"), { dwell: 300 });
  await s.click();
  await s.settle({ label: "after click" });
  await s.hold(600);
}

function fixtureClip(id: string): ClipDefinition {
  return clip(
    id,
    {
      title: "Recorder fixture",
      viewport: { width: 1000, height: 700 },
      seed: 3,
    },
    fixtureBody,
  );
}

async function record(
  browser: Browser,
  config: ResolvedConfig,
  id: string,
): Promise<{ timeline: Timeline; dir: string }> {
  return runClip(browser, config, fixtureClip(id));
}

function statePixel(
  dir: string,
  timeline: Timeline,
  frame: number,
  x: number,
  y: number,
): [number, number, number] {
  const file = timeline.states[timeline.frames[frame]];
  const png = PNG.sync.read(readFileSync(join(dir, "states", file)));
  const dpr = timeline.viewport.dpr;
  const index = (png.width * Math.round(y * dpr) + Math.round(x * dpr)) << 2;
  return [png.data[index], png.data[index + 1], png.data[index + 2]];
}

function stateHashes(dir: string): string[] {
  const states = join(dir, "states");
  return readdirSync(states)
    .sort()
    .map((name) =>
      createHash("sha1")
        .update(readFileSync(join(states, name)))
        .digest("hex"),
    );
}

test.describe("recording the fixture page", () => {
  let browser: Browser;
  let config: ResolvedConfig;
  let first: { timeline: Timeline; dir: string };

  test.beforeAll(async () => {
    browser = await launchBrowser();
    config = testConfig();
    first = await record(browser, config, "fixture-buttons");
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test("captures one state per authored frame", () => {
    const { timeline } = first;
    expect(timeline.durationFrames).toBe(timeline.frames.length);
    expect(timeline.durationFrames).toBeGreaterThan(90);
    expect(timeline.fps).toBe(60);
    for (const state of timeline.frames) {
      expect(state).toBeGreaterThanOrEqual(0);
      expect(state).toBeLessThan(timeline.states.length);
    }
    // Deduplication has to be doing something: a page that is still for 300ms
    // must not produce 18 identical files.
    expect(timeline.states.length).toBeGreaterThan(2);
    expect(timeline.states.length).toBeLessThan(timeline.durationFrames);
  });

  test("records the click it performed", () => {
    const { timeline } = first;
    expect(timeline.pointer.map((p) => p.kind)).toEqual(["down", "up"]);

    const [down, up] = timeline.pointer;
    expect(up.t).toBeGreaterThan(down.t);
    // The button sits at 400,300 and is 240x80.
    expect(down.at[0]).toBeGreaterThan(400);
    expect(down.at[0]).toBeLessThan(640);
    expect(down.at[1]).toBeGreaterThan(300);
    expect(down.at[1]).toBeLessThan(380);
  });

  test("the captured frames really passed through hover and press", () => {
    const { timeline, dir } = first;
    const [down, up] = timeline.pointer;
    const downFrame = Math.round(down.t * timeline.fps);
    const upFrame = Math.round(up.t * timeline.fps);

    // Sampled 20px inside the button's left edge: its label is centred and
    // white, so the centre pixel reads as text rather than as button colour.
    const [px, py] = [420, 340];

    // Idle: blue. The frame before the cursor has arrived.
    expect(statePixel(dir, timeline, 0, px, py)).toEqual([0, 0, 255]);

    // Hovered but not yet pressed: red. Playwright moved a real mouse, so the
    // page's own :hover rule fired — a cursor drawn in post could never do
    // this, which is why the cursor is synthetic but the input is not.
    expect(statePixel(dir, timeline, downFrame, px, py)).toEqual([255, 0, 0]);

    // Pressed: green, from :active.
    expect(statePixel(dir, timeline, downFrame + 1, px, py)).toEqual([
      0, 170, 0,
    ]);

    // Released, still hovered: red again.
    expect(statePixel(dir, timeline, upFrame + 1, px, py)).toEqual([255, 0, 0]);
  });

  test("marks the settle as a cut", () => {
    const { timeline } = first;
    expect(timeline.cuts.length).toBeGreaterThan(0);
    for (const cut of timeline.cuts) {
      expect(cut).toBeGreaterThanOrEqual(0);
      expect(cut).toBeLessThan(timeline.durationFrames);
    }
  });

  test("opens on a full-viewport camera and a cursor clear of the controls", () => {
    const { timeline } = first;
    expect(timeline.camera[0]).toEqual({
      t: 0,
      rect: { x: 0, y: 0, w: 1000, h: 700 },
      ease: "hold",
    });
    expect(timeline.cursor.length).toBeGreaterThan(0);
  });

  test("two independent runs produce byte-identical frames", async () => {
    // This is the property the whole design exists for, and the one assertion
    // that must never be loosened. If it fails, something outside the authored
    // clock leaked into a frame — an unwarmed resource, a real timer, a font
    // that had not finished loading — and the fix belongs there, not here.
    const second = await record(
      browser,
      testConfig(),
      "fixture-buttons-repeat",
    );

    expect(second.timeline.durationFrames).toBe(first.timeline.durationFrames);
    expect(second.timeline.frames).toEqual(first.timeline.frames);
    expect(second.timeline.cuts).toEqual(first.timeline.cuts);
    expect(second.timeline.cursor).toEqual(first.timeline.cursor);
    expect(second.timeline.pointer).toEqual(first.timeline.pointer);
    expect(stateHashes(second.dir)).toEqual(stateHashes(first.dir));

    // And the timelines differ in nothing but the id.
    const a = { ...first.timeline, clipId: "" };
    const b = { ...second.timeline, clipId: "" };
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

/**
 * Zooming on a control near the edge of the page.
 *
 * A pilot reported that this cropped the control, which would make the camera
 * useless for exactly the beats it exists for. The claim is checked here
 * end to end — a real locator, its real box, the camera key the driver wrote —
 * because `zoomRect` being right about rectangles would not prove the driver
 * passes it the right rectangle. `framing.test.ts` sweeps the whole boundary
 * for the arithmetic itself.
 */
test("a zoom on the control nearest the corner still contains it", async () => {
  const browser = await launchBrowser();
  try {
    let box: Rect | undefined;
    const { timeline } = await runClip(
      browser,
      testConfig(),
      clip(
        "edge-zoom",
        { title: "Edge zoom", viewport: { width: 1000, height: 700 } },
        async (s: RecordingSession) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/crowded.html");
          // The last cell of the lattice: the bottom-right-most control on
          // the page, 140px from one edge and 180px from the other.
          const target = s.byTestId("marker-71");
          box = await s.offCamera(async () => {
            const found = await target.boundingBox();
            if (!found) throw new Error("the fixture's last marker has no box");
            return {
              x: found.x,
              y: found.y,
              w: found.width,
              h: found.height,
            };
          });
          await s.camera.zoom(target);
          // A camera key is a track write and costs no time; without frames
          // after it the zoom would never be rendered at all.
          await s.hold(1200);
        },
      ),
    );

    const framing = timeline.camera[timeline.camera.length - 1].rect;
    expect(box).toBeDefined();
    expect(framing.x).toBeLessThanOrEqual(box!.x);
    expect(framing.y).toBeLessThanOrEqual(box!.y);
    expect(framing.x + framing.w).toBeGreaterThanOrEqual(box!.x + box!.w);
    expect(framing.y + framing.h).toBeGreaterThanOrEqual(box!.y + box!.h);
    // And the camera really moved, or the assertions above are about nothing.
    expect(framing.w).toBeLessThan(1000);
  } finally {
    await browser.close();
  }
});

/**
 * A caption belongs to the part of the clip it was written in.
 *
 * It used to belong to all of it: `from` defaulted to zero, so a second
 * caption ran from the start on top of the first and the renderer drew both on
 * every frame. On a contact sheet that reads as ghosted text — a rendering
 * fault, not an authoring one — which is where a pilot spent a round.
 */
test("a second caption starts where it was written, and ends the first", async () => {
  const browser = await launchBrowser();
  try {
    const { timeline } = await runClip(
      browser,
      testConfig(),
      clip(
        "two-captions",
        { title: "Two captions", viewport: { width: 1000, height: 700 } },
        async (s: RecordingSession) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/buttons.html");
          s.caption("First");
          await s.hold(500);
          s.caption("Second");
          await s.hold(500);
        },
      ),
    );

    const [first, second] = timeline.captions;
    expect(timeline.captions).toHaveLength(2);
    expect(first.t0).toBeCloseTo(0, 6);
    // Written after half a second of holding, and starting there.
    expect(second.t0).toBeCloseTo(0.5, 2);
    expect(first.t1).toBeCloseTo(second.t0, 6);
    // Which is the property that matters: no frame carries both.
    expect(first.t1).toBeLessThanOrEqual(second.t0);
    // And the last one still runs to the end of the clip.
    expect(second.t1).toBeCloseTo(timeline.durationFrames / timeline.fps, 6);
  } finally {
    await browser.close();
  }
});
