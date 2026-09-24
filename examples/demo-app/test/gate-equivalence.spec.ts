import { expect, test } from "@playwright/test";
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  compareRecordings,
  launchBrowser,
  loadClips,
  loadConfig,
  runClip,
  stateFileAt,
  withApp,
} from "versioncam";
import type { Comparison, RecordingRef } from "versioncam";

/**
 * The capture gate, against a real app rather than a fixture.
 *
 * The package tests the gate on a static page it serves itself, which proves
 * the logic. This proves the thing that actually matters: that on an app with
 * a router, a framework, a form, a spinner and a dialog, deciding not to take
 * a screenshot changes nothing about the recording. If it ever does, the
 * failure is a video that is quietly wrong, so this runs on every push.
 */

/**
 * The two pictures behind the first frame that differs, attached to the
 * result — which CI uploads when this fails. A hash says two frames are not
 * the same; only the pictures say how, and on a runner nobody can log into,
 * this is the only way to see them.
 */
async function showDifference(
  clipId: string,
  result: Comparison,
  runs: [string, RecordingRef][],
): Promise<string> {
  const frame = result.firstDifference;
  if (frame === null) return "";
  for (const [name, recording] of runs) {
    const state = stateFileAt(recording, frame);
    if (!state) continue;
    // Copied into the test's own output directory, which is what CI uploads,
    // rather than attached where it lies under `.versioncam/`.
    const copy = test
      .info()
      .outputPath(`${clipId}-frame-${frame}-${name}${extname(state)}`);
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(state, copy);
    await test.info().attach(basename(copy), { path: copy });
  }
  return `${result.frames - result.identical} of ${result.frames} frames differ, the first at frame ${frame}`;
}

test("the gate changes nothing, on every clip this app has", async () => {
  const config = await loadConfig(new URL("..", import.meta.url).pathname);
  const clips = await loadClips(config, []);
  expect(clips.length).toBeGreaterThan(0);

  // The app is started from its own config, the way `versioncam check` starts
  // it, and stopped again however this ends.
  await withApp(config, async () => {
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

        // Before blaming the gate, check the app. This compares two separate
        // recordings, so it can only mean anything if the app reproduces at
        // all — and an app that does not is a different problem with a
        // different fix. Only worth the third recording when something has
        // gone wrong.
        if (
          JSON.stringify(gated.timeline.frames) !==
          JSON.stringify(ungated.timeline.frames)
        ) {
          const control = await run(false);
          const twice = compareRecordings(control, ungated);
          const how = await showDifference(clip.id, twice, [
            ["ungated", ungated],
            ["control", control],
          ]);
          expect(
            twice.firstDifference,
            `${clip.id}: recorded twice the same way and got two different ` +
              `recordings (${how}), so this machine cannot reproduce this ` +
              `clip at all. That is not the gate; look for something in the ` +
              `app that does not depend on authored time.`,
          ).toBeNull();
        }

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
        const same = compareRecordings(gated, ungated);
        const how = await showDifference(clip.id, same, [
          ["ungated", ungated],
          ["gated", gated],
        ]);
        expect(same.firstDifference, `${clip.id}: pixels — ${how}`).toBeNull();
        expect(
          gated.cost.skipped,
          `${clip.id}: skipped nothing`,
        ).toBeGreaterThan(0);
      }
    } finally {
      await browser.close();
    }
  });
});
