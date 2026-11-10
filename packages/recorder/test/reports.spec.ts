import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "../src/driver/launch.js";
import { clip, runClip } from "../src/driver/clip.js";
import type { RecordingSession } from "../src/driver/session.js";
import type { SettleReport } from "../src/driver/settle.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * A recording has to describe itself.
 *
 * Nobody watches a clip being recorded — increasingly nobody *can*, because
 * what writes the clip is a subagent reading files. The waits are the part of
 * a run with nothing to show for it afterwards: they take the real time, they
 * are where a slow app shows up, and until now they existed only as a log line
 * on a terminal that had already scrolled away.
 */
test("a recording writes down every wait, and where its beats landed", async () => {
  const browser = await launchBrowser();
  try {
    const { timeline, dir, settles } = await runClip(
      browser,
      testConfig(),
      clip(
        "reports",
        {
          title: "Recorder fixture",
          viewport: { width: 1000, height: 700 },
          seed: 3,
        },
        async (s: RecordingSession) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/buttons.html");
          await s.hold(300);
          await s.hover(s.byTestId("target"), { dwell: 300 });
          await s.click();
          await s.settle({ label: "after click" });
          await s.hold(600);
        },
      ),
    );

    expect(settles.map((s) => s.label)).toEqual([
      "open /buttons.html",
      "after click",
    ]);
    for (const report of settles) {
      expect(report.timedOut).toBe(false);
      expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(report.lastBlocker.length).toBeGreaterThan(0);
    }

    // On disk as well as on the result: a caller that has the result should
    // not have to read a file, and a reader who arrives afterwards has nothing
    // else to read.
    const onDisk = JSON.parse(
      readFileSync(join(dir, "settles.json"), "utf8"),
    ) as SettleReport[];
    expect(onDisk).toEqual(settles);

    // One mark per labelled settle, in order.
    expect(timeline.marks.map((m) => m.label)).toEqual([
      "open /buttons.html",
      "after click",
    ]);

    // `open()` settles before any frame exists, and the frame it produced is
    // frame 0.
    expect(timeline.marks[0].frame).toBe(0);

    // The settle after the click captured nothing, so its mark is the frame
    // after the cut — which is the first picture of what the click did, and
    // really is a different picture.
    const beat = timeline.marks[1].frame;
    expect(timeline.cuts).toContain(beat - 1);
    expect(beat).toBeLessThan(timeline.durationFrames);
    expect(timeline.frames[beat]).not.toBe(timeline.frames[beat - 1]);
  } finally {
    await browser.close();
  }
});

test("a wait that gives up names what held it", async () => {
  // The name is how a person finds out why a clip is slow, so it has to be
  // what held the page. The last look at the page used to begin with no time
  // left, be cut off before the page could answer, and be taken for a
  // navigation: nearly every wait that gave up said "navigation", whatever
  // held it, and two requests a sign-in page left open were found only by
  // recording the clip again with more logging.
  const browser = await launchBrowser();
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args.join(" "));
  try {
    const { settles } = await runClip(
      browser,
      testConfig(),
      clip("held", { title: "Held" }, async (s) => {
        await s.offCamera(async (page) => {
          await installFixtureRoutes(page);
          await page.route("**/never", () => undefined);
        });
        await s.open("/buttons.html");
        await s.offCamera(async (page) => {
          const asked = page.waitForRequest("**/never");
          await page.evaluate(
            () => void fetch("/never").catch(() => undefined),
          );
          await asked;
        });
        await s.settle({ label: "held", timeoutMs: 1_000 });
        await s.hold(100);
      }),
    );
    const report = settles.find((r) => r.label === "held");
    expect(report?.timedOut).toBe(true);
    expect(report?.lastBlocker).toBe("requests(1)");
    // And the line a person reads says the same.
    expect(warned.join("\n")).toContain(
      "held gave up waiting after 1000ms (still requests(1))",
    );
  } finally {
    console.warn = warn;
    await browser.close();
  }
});
