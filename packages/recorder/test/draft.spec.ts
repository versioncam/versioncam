import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { clip, runClip } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import { renderRecording } from "../src/render/render.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * Draft mode: a cheap look at a clip while writing it.
 *
 * The claim being tested is not that a draft is fast — it is that a draft
 * stands in for the real thing. Same page, same layout, same authored
 * duration, and it renders. A draft that the app laid out differently would be
 * worse than no draft, because it could pass where the real capture fails.
 */

const body = async (s: RecordingSession): Promise<void> => {
  await s.offCamera(installFixtureRoutes);
  await s.open("/buttons.html");
  s.caption("Draft");
  await s.hover(s.byTestId("target"), { dwell: 200 });
  await s.click();
  await s.hold(400);
};

test("a draft is the same clip, shot cheaply", async () => {
  const browser = await launchBrowser();
  try {
    const base = testConfig();
    const run = (draft: boolean) =>
      runClip(
        browser,
        { ...base, recordingsDir: join(base.recordingsDir, String(draft)) },
        clip("draft-clip", { title: "Draft" }, body),
        { draft },
      );

    const full = await run(false);
    const draft = await run(true);

    // The clip lasts what the script said it lasts, either way. Only the
    // sampling rate differs — and with it the rounding: a draft's frames are
    // four times longer, so its duration can land up to one of them away from
    // the full capture's. That is the whole of the difference, and it is why a
    // draft is for looking at rather than for comparing against.
    const seconds = (r: typeof full) =>
      r.timeline.durationFrames / r.timeline.fps;
    expect(draft.timeline.fps).toBe(15);
    expect(full.timeline.fps).toBe(60);
    expect(Math.abs(seconds(draft) - seconds(full))).toBeLessThanOrEqual(
      1 / 15 + 1e-9,
    );

    // Its images are CSS-sized, and the timeline says so — that field is how
    // the renderer maps viewport coordinates into a state image.
    expect(draft.timeline.viewport.dpr).toBe(1);
    expect(full.timeline.viewport.dpr).toBe(2);
    expect(draft.timeline.meta.draft).toBe(true);
    expect(full.timeline.meta.draft).toBeUndefined();

    const shot = (r: typeof full): PNG =>
      PNG.sync.read(readFileSync(join(r.dir, "states", r.timeline.states[0])));
    expect(shot(draft).width).toBe(base.viewport.width);
    expect(shot(full).width).toBe(base.viewport.width * 2);

    // The point of the whole exercise.
    expect(draft.cost.framesMs).toBeLessThan(full.cost.framesMs);
  } finally {
    await browser.close();
  }
});

test("a draft renders, at the same size a full capture would", async () => {
  const browser = await launchBrowser();
  try {
    const config = testConfig();
    await runClip(
      browser,
      config,
      clip("draft-render", { title: "Draft" }, body),
      { draft: true },
    );
    const result = await renderRecording(browser, config, "draft-render");

    // A draft is a cheaper recording, not a smaller video: the output follows
    // the viewport exactly as it always does, so what you review is framed the
    // way the real thing will be.
    const probe = PNG.sync.read(readFileSync(result.poster));
    expect(probe.width).toBe(config.output.width);
    expect(probe.height).toBe(config.output.height);
  } finally {
    await browser.close();
  }
});
