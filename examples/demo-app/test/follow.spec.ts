import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  clip,
  launchBrowser,
  loadConfig,
  renderFrame,
  reviewRecording,
  runClip,
  withApp,
} from "versioncam";
import type { CameraKey, Rect, Timeline } from "versioncam";

/**
 * A camera that follows the cursor, recorded against a real app.
 *
 * The package's unit tests prove the path on cursor tracks built by hand:
 * continuous, inside the page, still inside the dead zone. This proves it
 * where it is used: a clip that fills in the form, crosses the page to the
 * list, and answers a dialog, with the camera following at one scale, through
 * the session, the timeline and the renderer as a user would meet them.
 *
 * The clip is written here rather than in `demos/clips/`, because CI renders
 * that directory and publishes it to the site; this is a test of the camera,
 * not a demo of the app. Its recordings go under `__follow/`, which neither
 * `render` nor the site's manifest reads.
 */

const APP = new URL("..", import.meta.url).pathname;
const SCALE = 1.35;

const FOLLOW = clip(
  "follow",
  { title: "Follow the cursor", seed: 44 },
  async (s) => {
    await s.open("/");
    s.caption("Follow the cursor");
    await s.hold(400);

    s.camera.follow({ scale: SCALE });
    await s.typeInto(s.byTestId("recipient"), "Mira Halloran");
    await s.hold(150);
    await s.typeInto(s.byTestId("destination"), "Reykjavík");
    await s.hold(250);
    await s.click(s.byTestId("create-shipment"));
    await s.hold(600);
    await s.settle({ label: "shipment created" });
    await s.hold(400);

    // Across the page, from the form to the list: the move a follow is for.
    await s.click(s.byTestId("cancel-3"));
    await s.settle({ label: "dialog open" });
    await s.hold(500);
    await s.click(s.byTestId("confirm-keep"));
    await s.settle({ label: "kept" });
    await s.hold(300);

    s.camera.reset();
    await s.hold(1300);
  },
);

/** The camera at a frame. Every key of a following camera is a frame's sample. */
function cameraAt(keys: CameraKey[], t: number): Rect {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].t <= t) i += 1;
  const a = keys[i];
  const b = keys[i + 1];
  if (!b || a.t === t) return a.rect;
  const u = (t - a.t) / (b.t - a.t);
  const lerp = (p: number, q: number) => p + (q - p) * u;
  return {
    x: lerp(a.rect.x, b.rect.x),
    y: lerp(a.rect.y, b.rect.y),
    w: lerp(a.rect.w, b.rect.w),
    h: lerp(a.rect.h, b.rect.h),
  };
}

/** The frame a step of the script began on. */
function stepFrame(timeline: Timeline, call: string): number {
  const step = (timeline.steps ?? []).find((s) => s.call === call);
  expect(step, `the timeline records ${call}`).toBeDefined();
  return step!.frame;
}

test("a camera that follows the cursor, on a real app", async () => {
  const config = await loadConfig(APP);
  await withApp(config, async () => {
    const browser = await launchBrowser();
    try {
      const run = (name: string) =>
        runClip(
          browser,
          {
            ...config,
            recordingsDir: join(config.recordingsDir, "__follow", name),
          },
          FOLLOW,
        );
      const first = await run("first");
      const { timeline } = first;
      const { width, height } = timeline.viewport;
      const fps = timeline.fps;
      const frames = Array.from({ length: timeline.durationFrames }, (_, f) =>
        cameraAt(timeline.camera, f / fps),
      );

      // Sampled, a key a frame where the camera moves.
      expect(timeline.camera[0].t).toBe(0);
      expect(timeline.camera.slice(1).every((k) => k.ease === "linear")).toBe(
        true,
      );

      // Inside the page at every frame.
      for (const r of frames) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(width + 1e-6);
        expect(r.y + r.h).toBeLessThanOrEqual(height + 1e-6);
      }

      // One scale, exactly, from the end of the blend in to the reset.
      const followFrom = stepFrame(timeline, "camera.follow");
      const resetAt = stepFrame(timeline, "camera.reset");
      const blend = Math.ceil((config.motion.zoomDurationMs / 1000) * fps);
      const following = frames.slice(followFrom + blend, resetAt);
      expect(following.length).toBeGreaterThan(4 * fps);
      for (const r of following) {
        expect(r.w).toBeCloseTo(width / SCALE, 2);
        expect(r.h).toBeCloseTo(height / SCALE, 2);
      }

      // It follows: across the page to the list, the camera goes with it.
      const centres = following.map((r) => r.x + r.w / 2);
      expect(Math.max(...centres) - Math.min(...centres)).toBeGreaterThan(200);

      // Without a jump anywhere. A step's frame is the first after its line
      // ran, so the frame before the follow's is the last it had not
      // touched: still the whole page.
      expect(frames[followFrom - 1]).toEqual({
        x: 0,
        y: 0,
        w: width,
        h: height,
      });
      // And never more than a steady pan's worth of change from one frame to
      // the next, entering, following or leaving.
      let largest = 0;
      for (let f = 1; f < frames.length; f += 1) {
        const a = frames[f - 1];
        const b = frames[f];
        largest = Math.max(
          largest,
          Math.abs(b.x - a.x),
          Math.abs(b.y - a.y),
          Math.abs(b.w - a.w),
        );
      }
      expect(largest).toBeLessThan(25);

      // Back to the whole page once the reset has had its duration.
      expect(frames[frames.length - 1]).toEqual({
        x: 0,
        y: 0,
        w: width,
        h: height,
      });

      // The dead zone: from the first field to the second, and on to the
      // button beneath it, the cursor moves a few tens of pixels at a time,
      // and the camera does not answer.
      const steps = timeline.steps ?? [];
      const typing = steps.filter((s) => s.call === "typeInto");
      const create = steps.find((s) => s.call === "click");
      expect(typing).toHaveLength(2);
      const still = frames.slice(typing[1].frame, create!.frame + 20);
      for (const r of still) expect(r).toEqual(still[0]);

      // Wherever the cursor rests while the camera follows it, it is in the
      // frame: on each field, on each button, over the dialog. Between those
      // it travels, and the package's unit tests check every frame of that.
      type Hold = Extract<Timeline["cursor"][number], { kind: "hold" }>;
      const holds = timeline.cursor.filter(
        (step): step is Hold =>
          step.kind === "hold" &&
          step.t0 >= followFrom / fps &&
          step.t1 <= resetAt / fps,
      );
      expect(holds.length).toBeGreaterThan(5);
      for (const hold of holds) {
        const [x, y] = hold.at;
        const last = Math.min(Math.floor(hold.t1 * fps), frames.length - 1);
        for (let f = Math.ceil(hold.t0 * fps); f <= last; f += 1) {
          const r = frames[f];
          expect(
            x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
            `the cursor resting at (${Math.round(x)}, ${Math.round(y)}) is in frame ${f}`,
          ).toBe(true);
        }
      }

      // Every click inside what the camera shows, and the rest of review.
      const review = reviewRecording({
        timeline,
        settles: first.settles,
        bounds: config.review,
      });
      const onscreen = review.items.find((i) => i.check === "onscreen");
      expect(onscreen?.pass, onscreen?.detail).toBe(true);
      expect(review.pass).toBe(true);

      // The same camera the second time, to the bit.
      const second = await run("second");
      expect(second.timeline.camera).toEqual(timeline.camera);

      // And the renderer draws a frame of it the same way twice.
      const target = {
        kind: "recording" as const,
        id: "follow",
        dir: first.dir,
      };
      const middle = Math.round((followFrom + resetAt) / 2);
      const shot = async () =>
        createHash("sha1")
          .update(await renderFrame(browser, config, target, middle))
          .digest("hex");
      expect(await shot()).toBe(await shot());
    } finally {
      await browser.close();
    }
  });
});
