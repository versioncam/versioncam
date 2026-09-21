import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  launchBrowser,
  loadClips,
  loadConfig,
  runClip,
} from "@living-demos/recorder";
import type { RunClipResult } from "@living-demos/recorder";

/**
 * The capture gate, against a real app rather than a fixture.
 *
 * The package tests the gate on a static page it serves itself, which proves
 * the logic. This proves the thing that actually matters: that on an app with
 * a router, a framework, a form, a spinner and a dialog, deciding not to take
 * a screenshot changes nothing about the recording. If it ever does, the
 * failure is a video that is quietly wrong, so this runs on every push.
 */

/** Every frame of a recording, as the bytes that frame actually shows. */
function framePixels({ timeline, dir }: RunClipResult): string[] {
  const states = timeline.states.map((name) =>
    createHash("sha1")
      .update(readFileSync(join(dir, "states", name)))
      .digest("hex"),
  );
  return timeline.frames.map((index) => states[index]);
}

test("the gate changes nothing, on every clip this app has", async () => {
  const config = await loadConfig(new URL("..", import.meta.url).pathname);
  const clips = await loadClips(config, []);
  expect(clips.length).toBeGreaterThan(0);

  const browser = await launchBrowser();
  try {
    for (const clip of clips) {
      const run = (gate: boolean) =>
        runClip(
          browser,
          {
            ...config,
            capture: { ...config.capture, gate },
            recordingsDir: join(
              config.recordingsDir,
              gate ? "__gated" : "__ungated",
            ),
          },
          clip,
        );

      const ungated = await run(false);
      const gated = await run(true);

      const saved = Math.round(
        (gated.cost.skipped / gated.timeline.durationFrames) * 100,
      );
      test.info().annotations.push({
        type: "gate",
        description: `${clip.id}: ${gated.cost.captured} captured, ${gated.cost.skipped} skipped (${saved}%)`,
      });

      expect(gated.timeline.frames, `${clip.id}: frame mapping`).toEqual(
        ungated.timeline.frames,
      );
      expect(framePixels(gated), `${clip.id}: pixels`).toEqual(
        framePixels(ungated),
      );
      expect(gated.cost.skipped, `${clip.id}: skipped nothing`).toBeGreaterThan(
        0,
      );
    }
  } finally {
    await browser.close();
  }
});
