import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { cpSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { clip, runClip } from "../src/driver/clip";
import type { RecordingSession } from "../src/driver/session";
import type { Timeline } from "../src/core/timeline";
import { FIXTURE_RECORDING, installFixtureRoutes, testConfig } from "./support";

/**
 * A golden-file check on the capture path: the same script, recorded again,
 * must produce the same timeline and the same state bytes as the committed
 * recording.
 *
 * The live byte-identity test next door proves two runs agree *now*; this one
 * proves they still agree with what was committed, which is what catches a
 * change to cursor planning or frame timing that nobody meant to make.
 *
 * Regenerate deliberately, never reflexively:
 *
 *     UPDATE_FIXTURE=1 npm run test:integration -w @living-demos/recorder
 *
 * The baseline was regenerated once during the extraction. The recording
 * inherited from the prototype had been made before two later changes to that
 * prototype — the cursor's resting position moved off the toolbar, and CSS
 * animations began being scrubbed by authored time — so it described a driver
 * that no longer existed anywhere.
 */
test("reproduces the committed recording of the fixture", async () => {
  const browser = await chromium.launch();
  try {
    const config = testConfig();
    const { timeline, dir } = await runClip(
      browser,
      config,
      clip(
        "parity",
        {
          title: "Recorder fixture",
          viewport: { width: 1000, height: 700 },
          seed: 3,
        },
        async (s: RecordingSession) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/buttons.html");
          s.caption("Recorder fixture");
          await s.hold(300);
          await s.hover(s.byTestId("target"), { dwell: 300 });
          await s.click();
          await s.settle({ label: "after click" });
          await s.hold(600);
        },
      ),
    );

    if (process.env.UPDATE_FIXTURE === "1") {
      rmSync(FIXTURE_RECORDING, { recursive: true, force: true });
      cpSync(dir, FIXTURE_RECORDING, { recursive: true });
      test.info().annotations.push({
        type: "fixture",
        description: `regenerated ${FIXTURE_RECORDING}`,
      });
    }

    const expected = JSON.parse(
      readFileSync(join(FIXTURE_RECORDING, "timeline.json"), "utf8"),
    ) as Timeline;

    // The timeline depends only on the driver, never on what the page showed,
    // so every field but the id must match.
    expect(timeline.durationFrames).toBe(expected.durationFrames);
    expect(timeline.frames).toEqual(expected.frames);
    expect(timeline.cuts).toEqual(expected.cuts);
    expect(timeline.cursor).toEqual(expected.cursor);
    expect(timeline.pointer).toEqual(expected.pointer);
    expect(timeline.camera).toEqual(expected.camera);
    expect(timeline.captions).toEqual(expected.captions);

    const hashes = (root: string) => {
      const states = join(root, "states");
      return readdirSync(states)
        .sort()
        .map((n) =>
          createHash("sha1")
            .update(readFileSync(join(states, n)))
            .digest("hex"),
        );
    };
    expect(hashes(dir)).toEqual(hashes(FIXTURE_RECORDING));
  } finally {
    await browser.close();
  }
});
