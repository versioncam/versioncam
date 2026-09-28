import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { clip, runClip } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * A recording says what its script did, and which versioncam made it.
 *
 * version.cam's front page plays a clip beside its source and lights the line
 * that is running, and prints the version that recorded it in the colour kept
 * for numbers that can be trusted. Both are only true if the recording
 * carries them: the steps are one per line of the script, never the calls
 * the session makes to itself, and the version is the recorder's own.
 */
test("a recording lists its script's steps, and the version that made it", async () => {
  test.setTimeout(90_000);
  const browser = await launchBrowser();
  try {
    const stepped = clip(
      "stepped",
      { title: "Stepped", viewport: { width: 1000, height: 700 }, seed: 3 },
      async (s: RecordingSession) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/fields.html");
        s.caption("A city");
        await s.hold(200);
        await s.camera.zoom(s.byTestId("city"), 1.4);
        await s.typeInto(s.byLabel("City"), "Ljubljana");
        s.camera.reset();
        await s.hold(300);
      },
    );
    const { timeline } = await runClip(browser, testConfig(), stepped);

    // One step per line, in order: typeInto is one step, not also the click
    // it makes, and a locator factory is an argument, not a step.
    expect(timeline.steps?.map((step) => step.call)).toEqual([
      "offCamera",
      "open",
      "caption",
      "hold",
      "camera.zoom",
      "typeInto",
      "camera.reset",
      "hold",
    ]);

    const [, open, caption, hold, zoom, typeInto, reset, lastHold] =
      timeline.steps ?? [];
    expect(open.frame).toBe(0);
    // Track writes spend no time: they begin on the frame the next line does.
    expect(caption.frame).toBe(hold.frame);
    expect(zoom.frame).toBe(typeInto.frame);
    // Typing spends time, so what follows it begins later.
    expect(reset.frame).toBeGreaterThan(typeInto.frame);
    expect(lastHold.frame).toBe(reset.frame);
    expect(lastHold.frame).toBeLessThan(timeline.durationFrames);

    const { version } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(timeline.meta.recorder).toBe(version);
  } finally {
    await browser.close();
  }
});
