import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clip, runClip } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RunClipResult } from "../src/driver/clip.js";
import type { RecordingSession } from "../src/driver/session.js";
import type { Timeline } from "../src/core/timeline.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * The capture gate: skipping a screenshot when nothing about the page changed.
 *
 * The only claim that matters is that it changes nothing. A gate that is
 * merely fast is worthless, because the failure it produces is a video that is
 * subtly wrong — which nobody notices until it is on a website.
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

async function bothWays(
  id: string,
  body: (s: RecordingSession) => Promise<void>,
  capture: { forceCaptureEvery?: number } = {},
): Promise<{ gated: RunClipResult; ungated: RunClipResult }> {
  const browser = await launchBrowser();
  try {
    const base = testConfig();
    const run = (gate: boolean) =>
      runClip(
        browser,
        {
          ...base,
          capture: { ...base.capture, ...capture, gate },
          recordingsDir: join(base.recordingsDir, gate ? "gated" : "ungated"),
        },
        clip(id, { title: id }, body),
      );
    return { ungated: await run(false), gated: await run(true) };
  } finally {
    await browser.close();
  }
}

test("a gated recording is the same recording, frame for frame", async () => {
  const { gated, ungated } = await bothWays("gate-parity", async (s) => {
    await s.offCamera(installFixtureRoutes);
    await s.open("/buttons.html");
    s.caption("Gate parity");
    await s.hold(300);
    // A hover and a press: both change how the page looks without changing
    // the DOM at all, which is exactly what the gate has to notice.
    await s.hover(s.byTestId("target"), { dwell: 300 });
    await s.click();
    await s.settle({ label: "after click" });
    await s.hold(600);
  });

  expect(gated.timeline.frames).toEqual(ungated.timeline.frames);
  expect(framePixels(gated)).toEqual(framePixels(ungated));
  expect(gated.timeline.states.length).toBe(ungated.timeline.states.length);

  // And it did actually skip, or the assertions above prove nothing.
  expect(gated.cost.skipped).toBeGreaterThan(0);
  expect(gated.cost.captured).toBeLessThan(ungated.cost.captured);
});

test("a canvas redraws where the gate cannot see, and the floor catches it", async () => {
  // The fixture's square moves every animation frame while the DOM, the
  // element under the cursor and the animation list all hold perfectly still.
  const body = async (s: RecordingSession): Promise<void> => {
    await s.offCamera(installFixtureRoutes);
    await s.open("/canvas.html");
    await s.hold(1000);
  };

  const { gated, ungated } = await bothWays("gate-canvas", body, {
    forceCaptureEvery: 5,
  });

  const frames = gated.timeline.durationFrames;
  // Without the floor this recording would be one still image. With it, the
  // clip samples the canvas at least every fifth frame.
  expect(gated.timeline.states.length).toBeGreaterThanOrEqual(
    Math.floor(frames / 5) - 1,
  );
  // It is still a worse recording than an ungated one, and that is the honest
  // shape of the trade — which is why this is a config field and not a guess.
  expect(gated.timeline.states.length).toBeLessThan(
    ungated.timeline.states.length,
  );
});

test("the gate is on unless a clip says otherwise", async () => {
  const browser = await launchBrowser();
  try {
    const base = testConfig();
    const body = async (s: RecordingSession): Promise<void> => {
      await s.offCamera(installFixtureRoutes);
      await s.open("/buttons.html");
      await s.hold(500);
    };
    const on = await runClip(
      browser,
      { ...base, recordingsDir: join(base.recordingsDir, "on") },
      clip("gate-default", { title: "default" }, body),
    );
    const off = await runClip(
      browser,
      { ...base, recordingsDir: join(base.recordingsDir, "off") },
      // A clip that films a canvas turns the gate off for itself, rather than
      // every other clip paying for it.
      clip(
        "gate-opt-out",
        { title: "opt out", capture: { gate: false } },
        body,
      ),
    );
    expect(on.cost.skipped).toBeGreaterThan(0);
    expect(off.cost.skipped).toBe(0);
    expect((off.timeline as Timeline).meta.captured).toBe(
      off.timeline.durationFrames,
    );
  } finally {
    await browser.close();
  }
});
