import { expect, test } from "@playwright/test";
import type { Browser } from "playwright";
import type { RecorderConfig } from "../src/config.js";
import { compareRecordings } from "../src/driver/compare.js";
import { clip, runClip } from "../src/driver/clip.js";
import type { ClipBody } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * `scroll()`: an authored scroll on the clip's clock (docs: dsl.md, scroll).
 *
 * The fixture asks for smooth scrolling on the page and on its pane, so each
 * test that reads where a scroll landed is also a test that the browser's
 * own animation, which runs on real time, played no part in it.
 */

type Offsets = {
  top: number;
  max: number;
  pageY: number;
  pageMax: number;
};

/** The pane's offset and range, and the page's, as of the last frame. */
const offsets = (s: RecordingSession): Promise<Offsets> =>
  s.offCamera((page) =>
    page.evaluate(() => {
      const pane = document.getElementById("pane");
      if (!pane) throw new Error("the fixture has no #pane");
      const root = document.scrollingElement ?? document.documentElement;
      return {
        top: pane.scrollTop,
        max: pane.scrollHeight - pane.clientHeight,
        pageY: root.scrollTop,
        pageMax: root.scrollHeight - root.clientHeight,
      };
    }),
  );

/** Where row `n` sits in the pane's visible box: its top, centre and bottom. */
const rowInPane = (s: RecordingSession, n: number) =>
  s.offCamera((page) =>
    page.evaluate((index) => {
      const pane = document.getElementById("pane");
      const row = document.querySelector(`[data-testid="row-${index}"]`);
      if (!pane || !row) throw new Error(`the fixture has no row ${index}`);
      const box = pane.getBoundingClientRect();
      const top = box.top + pane.clientTop;
      const bottom = top + pane.clientHeight;
      const r = row.getBoundingClientRect();
      return {
        start: r.top - top,
        center: r.top + r.height / 2 - (top + bottom) / 2,
        end: r.bottom - bottom,
      };
    }, n),
  );

/** Record `body` on the scrolling fixture. */
function record(
  browser: Browser,
  id: string,
  body: ClipBody,
  config: Partial<RecorderConfig> = {},
) {
  return runClip(
    browser,
    testConfig(config),
    clip(id, { title: "Scrolling" }, async (s) => {
      await s.offCamera(installFixtureRoutes);
      await s.open("/scrolling.html");
      await body(s);
    }),
  );
}

test.describe("scroll()", () => {
  let browser: Browser;
  test.beforeAll(async () => {
    browser = await launchBrowser();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  test("lands exactly at the end of a pane that asks for smooth scrolling", async () => {
    let after: Offsets | null = null;
    const result = await record(browser, "scroll-bottom", async (s) => {
      await s.scroll(s.byTestId("pane"), { to: "bottom" });
      after = await offsets(s);
    });
    expect(after).not.toBeNull();
    const { top, max } = after as unknown as Offsets;
    expect(max).toBeGreaterThan(0);
    // Exactly, not nearly: the last step is the end itself, and a smooth
    // scroll left to the browser would still be on its way.
    expect(top).toBe(max);
    expect(result.timeline.scrolls).toEqual([
      expect.objectContaining({ axis: "y", from: 0, to: max }),
    ]);
  });

  test("records the end it reached, clamped, not the end it was asked for", async () => {
    let after: Offsets | null = null;
    const result = await record(browser, "scroll-clamped", async (s) => {
      await s.scroll(s.byTestId("pane"), { by: 99_999 }, { duration: 200 });
      await s.scroll(s.byTestId("pane"), { to: -500 }, { duration: 200 });
      after = await offsets(s);
    });
    const { top, max } = after as unknown as Offsets;
    expect(top).toBe(0);
    const [down, up] = result.timeline.scrolls ?? [];
    expect(down).toMatchObject({ from: 0, to: max });
    expect(up).toMatchObject({ from: max, to: 0 });
    // The pane's box, as the step measured it: the same box the targets
    // sidecar holds for the step.
    expect(down.rect).toEqual({ x: 80, y: 80, w: 400, h: 300 });
  });

  test("captures every frame of the scroll, though no node changes and the cursor is elsewhere", async () => {
    let span = { first: 0, last: 0 };
    const result = await record(browser, "scroll-captured", async (s) => {
      // The cursor starts at 0.72 x 0.28 of the page, well clear of the
      // pane, so nothing under it changes as the pane scrolls.
      await s.hold(100);
      const first = s.at.frame + 1;
      await s.scroll(s.byTestId("pane"), { by: 600 });
      span = { first, last: s.at.frame };
      await s.hold(100);
    });
    const frames = result.timeline.frames.slice(span.first, span.last + 1);
    // 700 ms at 60 fps.
    expect(frames).toHaveLength(42);
    // A frame the gate skipped repeats the one before it. Minimum-jerk
    // starts and ends slowly, so the first and last steps move the pane by
    // less than a device pixel and may photograph alike; everywhere between,
    // each frame is a new picture.
    const middle = frames.slice(4, -4);
    for (let k = 1; k < middle.length; k += 1) {
      expect(middle[k], `frame ${span.first + 4 + k}`).not.toBe(middle[k - 1]);
    }
  });

  test("makes the same bytes on every run, with the cursor over the rows it scrolls", async () => {
    const body: ClipBody = async (s) => {
      await s.moveTo(s.byTestId("row-3"));
      await s.scroll(s.byTestId("pane"), { by: 450 });
      await s.hold(200);
      await s.scroll(s.byTestId("pane"), { into: s.byTestId("row-38") });
      await s.scroll("page", { by: 500 });
      await s.hold(200);
    };
    const first = await record(browser, "scroll-twice-a", body);
    const second = await record(browser, "scroll-twice-b", body);
    const comparison = compareRecordings(first, second);
    expect(comparison.frames).toBeGreaterThan(100);
    expect(comparison.firstDifference).toBeNull();
    const { clipId: _a, ...one } = first.timeline;
    const { clipId: _b, ...other } = second.timeline;
    expect(one).toEqual(other);
  });

  test("into brings a row to the start, the centre or the end of the pane", async () => {
    const landed: Record<string, number> = {};
    await record(browser, "scroll-into", async (s) => {
      for (const block of ["start", "end", "center"] as const) {
        await s.scroll(
          s.byTestId("pane"),
          { into: s.byTestId("row-20"), block },
          { duration: 200 },
        );
        landed[block] = (await rowInPane(s, 20))[block];
      }
      // Without a block, the centre.
      await s.scroll(s.byTestId("pane"), { to: "top" }, { duration: 200 });
      await s.scroll(s.byTestId("pane"), { into: s.byTestId("row-20") });
      landed.default = (await rowInPane(s, 20)).center;
    });
    // Within a pixel: Chromium keeps a scroll offset to its device pixel.
    for (const [block, offBy] of Object.entries(landed)) {
      expect(Math.abs(offBy), block).toBeLessThanOrEqual(1);
    }
  });

  test("scrolls the page itself, and the cursor holds where it was", async () => {
    let after: Offsets | null = null;
    let span = { t0: 0, t1: 0 };
    const result = await record(browser, "scroll-page", async (s) => {
      const t0 = s.at.t;
      await s.scroll("page", { by: 900 });
      span = { t0, t1: s.at.t };
      after = await offsets(s);
    });
    const { pageY, pageMax } = after as unknown as Offsets;
    expect(pageMax).toBeGreaterThan(900);
    expect(pageY).toBe(900);
    expect(result.timeline.scrolls?.[0]).toMatchObject({
      rect: { x: 0, y: 0, w: 1000, h: 700 },
      from: 0,
      to: 900,
    });
    const during = result.timeline.cursor.filter(
      (step) => step.t0 >= span.t0 && step.t1 <= span.t1,
    );
    expect(during).toEqual([
      expect.objectContaining({ kind: "hold", t0: span.t0, t1: span.t1 }),
    ]);
  });

  test("leaves a recording without a scroll as it was", async () => {
    const result = await record(browser, "scroll-none", async (s) => {
      await s.hold(100);
    });
    expect("scrolls" in result.timeline).toBe(false);
  });

  test("refuses a pane that cannot scroll, and a where it cannot read", async () => {
    await expect(
      record(browser, "scroll-still", async (s) => {
        await s.scroll(s.byTestId("still"), { by: 100 });
      }),
    ).rejects.toThrow(/does not scroll vertically: everything in it fits/);
    await expect(
      record(browser, "scroll-nowhere", async (s) => {
        await s.scroll(s.byTestId("pane"), {} as never);
      }),
    ).rejects.toThrow(/say where with one of/);
    await expect(
      record(browser, "scroll-string", async (s) => {
        await s.scroll(s.byTestId("pane"), { by: "40" as unknown as number });
      }),
    ).rejects.toThrow(/`by` is pixels, got 40/);
  });
});
