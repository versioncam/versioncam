import { expect, test } from "@playwright/test";
import type { Request } from "playwright";
import { compareRecordings, readRecording } from "../src/driver/compare.js";
import { clip, runClip } from "../src/driver/clip.js";
import type { ClipBody } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RecordingSession } from "../src/driver/session.js";
import {
  ELSEWHERE_ORIGIN,
  installFixtureRoutes,
  testConfig,
} from "./support.js";

/**
 * A clip can go from one document to another.
 *
 * A server-rendered app, Django or Rails or Laravel, changes page by loading a
 * new document: a plain link, a form post, a redirect after it. Each destroys
 * the page the recorder was talking to. Until 0.7.3 that failed the clip twice
 * over, once when a probe lost its context and again because any second
 * document was taken for a dev server's push. So the first thing a stranger
 * would try on such an app could not be filmed, and every test before this
 * file drove pages that route on the client or do not route at all.
 */

const text = (s: RecordingSession, testId: string): Promise<string | null> =>
  s.offCamera((page) => page.getByTestId(testId).textContent());

/** One clip, twice, compared frame by frame the way `stability` compares. */
async function twice(name: string, body: ClipBody): Promise<void> {
  const browser = await launchBrowser();
  try {
    const config = testConfig();
    const runs = [];
    for (const run of [1, 2]) {
      const result = await runClip(
        browser,
        { ...config, recordingsDir: `${config.recordingsDir}/run-${run}` },
        clip(name, { title: name }, body),
        { draft: true },
      );
      runs.push(result.dir);
    }
    const comparison = compareRecordings(
      readRecording(runs[0]),
      readRecording(runs[1]),
    );
    expect(comparison.firstDifference).toBeNull();
  } finally {
    await browser.close();
  }
}

test("a link to another document is filmed, with a settle after it", async () => {
  const browser = await launchBrowser();
  try {
    let title: string | null = null;
    const result = await runClip(
      browser,
      testConfig(),
      clip("nav-link", { title: "Link" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-a.html");
        await s.hold(200);
        await s.click(s.byTestId("link"));
        await s.settle({ label: "page b" });
        await s.hold(300);
        title = await text(s, "title");
      }),
    );
    expect(title).toBe("Page B");
    expect(result.timeline.marks.map((m) => m.label)).toContain("page b");
  } finally {
    await browser.close();
  }
});

test("a form post is filmed, and the next page can be used", async () => {
  const browser = await launchBrowser();
  try {
    let clicked: string | null = null;
    await runClip(
      browser,
      testConfig(),
      clip("nav-form", { title: "Form" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-a.html");
        await s.typeInto(s.byTestId("field"), "berg");
        await s.click(s.byTestId("send"));
        await s.settle({ label: "sent" });
        await s.click(s.byTestId("count"));
        await s.settle({ label: "clicked" });
        await s.hold(200);
        clicked = await text(s, "count");
      }),
    );
    expect(clicked).toBe("Clicked");
  } finally {
    await browser.close();
  }
});

test("Enter in a form navigates as a click does", async () => {
  const browser = await launchBrowser();
  try {
    let title: string | null = null;
    await runClip(
      browser,
      testConfig(),
      clip("nav-enter", { title: "Enter" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-a.html");
        await s.typeInto(s.byTestId("field"), "berg");
        await s.press("Enter");
        await s.settle({ label: "sent" });
        await s.hold(200);
        title = await text(s, "title");
      }),
    );
    expect(title).toBe("Page B");
  } finally {
    await browser.close();
  }
});

test("a navigation with no settle after it never shows a half-loaded page", async () => {
  // A clip that holds instead of settling still gets the wait: the frame loop
  // sees the navigation, and the next frame it makes is of the finished page,
  // with the page's own script already run.
  const browser = await launchBrowser();
  try {
    let timer: string | null = null;
    let frames = 0;
    let cutsBefore = 0;
    const result = await runClip(
      browser,
      testConfig(),
      clip("nav-hold", { title: "Hold" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-a.html");
        await s.click(s.byTestId("link"));
        cutsBefore = s.at.frame;
        await s.hold(600);
        timer = await text(s, "timer");
        frames = s.at.frame;
      }),
    );
    // The new page's 300 ms timer has fired, on the page's clock, within the
    // 600 ms of frames that followed.
    expect(timer).toBe("Timer fired");
    expect(frames).toBeGreaterThan(cutsBefore);
    expect(result.timeline.cuts).toContain(cutsBefore);
  } finally {
    await browser.close();
  }
});

test("a navigation from the page's own timer is filmed too", async () => {
  const browser = await launchBrowser();
  try {
    let title: string | null = null;
    await runClip(
      browser,
      testConfig(),
      clip("nav-late", { title: "Late" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-a.html");
        await s.click(s.byTestId("late"));
        await s.hold(500);
        await s.settle({ label: "arrived" });
        title = await text(s, "title");
      }),
    );
    expect(title).toBe("Page B");
  } finally {
    await browser.close();
  }
});

test("a second open goes on from where the clip is, and does not restart it", async () => {
  const browser = await launchBrowser();
  try {
    let before = 0;
    let after = 0;
    const result = await runClip(
      browser,
      testConfig(),
      clip("nav-open", { title: "Open" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-a.html");
        await s.hold(300);
        before = s.at.frame;
        await s.open("/navigation-b.html");
        await s.hold(300);
        after = s.at.frame;
      }),
    );
    expect(after).toBeGreaterThan(before);
    expect(result.timeline.frames.length).toBe(after + 1);
    // Every frame has a picture: a hole here is a clip the renderer cannot play.
    expect(result.timeline.frames.every((f) => typeof f === "number")).toBe(
      true,
    );
    // The frame after the second open shows the new page, not the last picture
    // of the old one, whatever the two pages' mutation counts happen to be.
    expect(result.timeline.frames[before + 1]).not.toBe(
      result.timeline.frames[before],
    );
  } finally {
    await browser.close();
  }
});

test("the page's clock carries on across a navigation", async () => {
  // A clip's time is one timeline: the page that loads second must not see
  // the instant the clip began, or a date on it would go backwards.
  const browser = await launchBrowser();
  try {
    let first = 0;
    let second = 0;
    await runClip(
      browser,
      testConfig(),
      clip("nav-clock", { title: "Clock" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-a.html");
        await s.hold(500);
        first = await s.offCamera((page) => page.evaluate(() => Date.now()));
        await s.click(s.byTestId("link"));
        await s.settle({ label: "page b" });
        second = await s.offCamera((page) => page.evaluate(() => Date.now()));
      }),
    );
    expect(second).toBeGreaterThanOrEqual(first);
  } finally {
    await browser.close();
  }
});

test("a clip that navigates records the same twice", async () => {
  await twice("nav-twice", async (s) => {
    await s.offCamera(installFixtureRoutes);
    await s.open("/navigation-a.html");
    await s.hold(200);
    await s.typeInto(s.byTestId("field"), "berg");
    await s.click(s.byTestId("send"));
    await s.settle({ label: "sent" });
    await s.hold(400);
    await s.click(s.byTestId("back"));
    await s.settle({ label: "back" });
    await s.hold(200);
    await s.click(s.byTestId("link"));
    await s.hold(500);
  });
});

test("a hover on the new page starts from the cursor, on every run", async () => {
  // The link on page B sits where the cursor rests after the click on page A,
  // so what the first frames of B show depends on the hover being decided
  // before them and not when Chromium's own timer gets round to it.
  await twice("nav-hover", async (s) => {
    await s.offCamera(installFixtureRoutes);
    await s.open("/navigation-a.html");
    await s.click(s.byTestId("link"));
    await s.hold(400);
  });
});

test("a request the old page left waiting does not hold up the new one", async () => {
  // A long poll, a stream, anything still open when the document goes. If it
  // were still counted as in flight, every settle after it would wait out its
  // whole budget for an answer that can no longer arrive.
  const browser = await launchBrowser();
  try {
    const result = await runClip(
      browser,
      testConfig(),
      clip("nav-pending", { title: "Pending" }, async (s) => {
        await s.offCamera(async (page) => {
          await installFixtureRoutes(page);
          await page.route("**/never", () => undefined);
        });
        await s.open("/navigation-a.html");
        await s.offCamera((page) =>
          page.evaluate(() => void fetch("/never").catch(() => undefined)),
        );
        await s.click(s.byTestId("link"));
        await s.settle({ label: "page b" });
        await s.hold(100);
      }),
    );
    const report = result.settles.find((r) => r.label === "page b");
    expect(report?.timedOut).toBe(false);
    expect(report?.elapsedMs).toBeLessThan(10_000);
  } finally {
    await browser.close();
  }
});

test("a request the old page left waiting does not hold up a page on another site", async () => {
  // The test above passes on its own: on the same site Chromium cancels the
  // request as the page goes, and Playwright reports it failed. When the new
  // page is on another site, Playwright never reports it at all, finished or
  // failed, and a count kept from those reports kept it for the rest of the
  // clip. Vercel's sign-in page left two that way on its way back to the
  // preview, and every settle after it waited out its whole time.
  const browser = await launchBrowser();
  try {
    const never = { asked: 0, ended: 0 };
    const result = await runClip(
      browser,
      testConfig(),
      clip("nav-pending-elsewhere", { title: "Pending" }, async (s) => {
        await s.offCamera(async (page) => {
          await installFixtureRoutes(page);
          await installFixtureRoutes(page, ELSEWHERE_ORIGIN);
          await page.route("**/never", () => undefined);
          const isNever = (request: Request): boolean =>
            request.url().endsWith("/never");
          page.on("request", (request) => {
            if (isNever(request)) never.asked += 1;
          });
          for (const event of ["requestfinished", "requestfailed"] as const) {
            page.on(event, (request) => {
              if (isNever(request)) never.ended += 1;
            });
          }
        });
        await s.open("/navigation-a.html");
        await s.offCamera(async (page) => {
          const asked = page.waitForRequest("**/never");
          await page.evaluate(
            () => void fetch("/never").catch(() => undefined),
          );
          await asked;
        });
        await s.click(s.byTestId("elsewhere"));
        await s.settle({ label: "page b" });
        await s.click(s.byTestId("count"));
        await s.settle({ label: "clicked" });
        await s.hold(100);
      }),
      // So the test fails in seconds, not minutes, if the count comes back.
      { arriveWithinMs: 10_000 },
    );
    // The case this test is for: asked once, and never heard of again. If
    // Playwright starts reporting it, the test above covers it, and this one
    // no longer tests anything.
    expect(never).toEqual({ asked: 1, ended: 0 });
    expect(
      result.settles.filter((r) => r.timedOut).map((r) => r.label),
    ).toEqual([]);
    for (const label of ["page b", "clicked"]) {
      const report = result.settles.find((r) => r.label === label);
      expect(report?.elapsedMs).toBeLessThan(10_000);
    }
  } finally {
    await browser.close();
  }
});

test("a request still open when the address changes in place still holds a settle", async () => {
  // The History API changes the address and keeps the document, and whatever
  // the page asked for is still on its way to it. Only a new document leaves
  // the old one's requests behind.
  const browser = await launchBrowser();
  try {
    const result = await runClip(
      browser,
      testConfig(),
      clip("nav-pending-pushed", { title: "Pending" }, async (s) => {
        await s.offCamera(async (page) => {
          await installFixtureRoutes(page);
          await page.route("**/never", () => undefined);
        });
        await s.open("/navigation-a.html");
        await s.offCamera(async (page) => {
          // Reported before the address changes, or the test would not be
          // asking about a request the old address made.
          const asked = page.waitForRequest("**/never");
          await page.evaluate(
            () => void fetch("/never").catch(() => undefined),
          );
          await asked;
          await page.evaluate(() =>
            history.pushState({}, "", "/navigation-a.html?pushed"),
          );
        });
        await s.settle({ label: "pushed", timeoutMs: 1_500 });
      }),
    );
    const report = result.settles.find((r) => r.label === "pushed");
    expect(report?.timedOut).toBe(true);
  } finally {
    await browser.close();
  }
});

test("a request the new page makes as it loads still holds a settle", async () => {
  // Its request comes after the commit that drops the old page's, so it is
  // counted, however early the page makes it.
  const browser = await launchBrowser();
  try {
    const result = await runClip(
      browser,
      testConfig(),
      clip("nav-pending-arrived", { title: "Pending" }, async (s) => {
        await s.offCamera(async (page) => {
          await installFixtureRoutes(page);
          await page.route(`${ELSEWHERE_ORIGIN}/navigation-b.html`, (route) =>
            route.fulfill({
              contentType: "text/html",
              body: `<h1>Page B</h1><script>fetch("/never")</script>`,
            }),
          );
          await page.route("**/never", () => undefined);
        });
        await s.open("/navigation-a.html");
        await s.click(s.byTestId("elsewhere"));
        await s.settle({ label: "page b", timeoutMs: 1_500 });
      }),
      { arriveWithinMs: 1_500 },
    );
    const report = result.settles.find((r) => r.label === "page b");
    expect(report?.timedOut).toBe(true);
  } finally {
    await browser.close();
  }
});

test("a reload the clip did not ask for still fails the clip, and says why", async () => {
  // What the old rule was for: a dev server pushing a reload at a page being
  // recorded. It is told from a navigation by the browser's own account of how
  // the document came to be loaded.
  const browser = await launchBrowser();
  try {
    await expect(
      runClip(
        browser,
        testConfig(),
        clip("nav-reload", { title: "Reload" }, async (s) => {
          await s.offCamera(installFixtureRoutes);
          await s.open("/navigation-a.html");
          await s.click(s.byTestId("reload"));
          await s.settle({ label: "after" });
          await s.hold(300);
        }),
      ),
    ).rejects.toThrow(/reloaded 1 time\(s\).*editing a file/s);
  } finally {
    await browser.close();
  }
});

test("a page that reloads itself as it opens has lost nothing", async () => {
  // Nothing is filmed yet, so this is not the failure a dev server's push is:
  // frame 0 is of the page that stayed.
  const browser = await launchBrowser();
  try {
    let title: string | null = null;
    await runClip(
      browser,
      testConfig(),
      clip("nav-self-reload", { title: "Self" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-reloads.html");
        await s.hold(100);
        title = await text(s, "title");
      }),
    );
    expect(title).toBe("Here now");
  } finally {
    await browser.close();
  }
});

test("a slow server's wait shows up in a settle, and honours its timeout", async () => {
  // Chromium holds calls to the page until the new document commits. The press
  // must not sit in that hold with no limit and no report: the time belongs to
  // the settle, and a settle told to give up gives up.
  const browser = await launchBrowser();
  try {
    let clickMs = 0;
    const result = await runClip(
      browser,
      testConfig(),
      clip("nav-slow", { title: "Slow" }, async (s) => {
        await s.offCamera(async (page) => {
          await installFixtureRoutes(page);
          await page.route("**/navigation-b.html", async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 2_500));
            await route.fallback();
          });
        });
        await s.open("/navigation-a.html");
        const began = performance.now();
        await s.click(s.byTestId("link"));
        clickMs = performance.now() - began;
        await s.settle({ label: "gave up", timeoutMs: 500 });
        await s.settle({ label: "arrived" });
        await s.hold(100);
      }),
    );
    // The approach is under a second of the machine's time; 2.5 s would be the hold.
    expect(clickMs).toBeLessThan(2_400);
    const gaveUp = result.settles.find((r) => r.label === "gave up");
    expect(gaveUp?.timedOut).toBe(true);
    expect(gaveUp?.lastBlocker).toBe("navigation");
    const arrived = result.settles.find((r) => r.label === "arrived");
    expect(arrived?.timedOut).toBe(false);
    expect(arrived?.elapsedMs).toBeGreaterThan(500);
  } finally {
    await browser.close();
  }
});

test("the page's clock stands still while the server takes its time", async () => {
  // What the new page reads must not depend on how long the server took.
  const browser = await launchBrowser();
  try {
    const dates: number[] = [];
    for (const delay of [0, 1_200]) {
      await runClip(
        browser,
        testConfig(),
        clip("nav-date", { title: "Date" }, async (s) => {
          await s.offCamera(async (page) => {
            await installFixtureRoutes(page);
            await page.route("**/navigation-b.html", async (route) => {
              await new Promise((resolve) => setTimeout(resolve, delay));
              await route.fallback();
            });
          });
          await s.open("/navigation-a.html");
          await s.click(s.byTestId("link"));
          await s.settle({ label: "b" });
          dates.push(new Date((await text(s, "now")) ?? "invalid").getTime());
        }),
      );
    }
    expect(dates[1]).toBe(dates[0]);
  } finally {
    await browser.close();
  }
});

test("a page that never arrives fails the clip and names where it was going", async () => {
  const browser = await launchBrowser();
  try {
    await expect(
      runClip(
        browser,
        testConfig(),
        clip("nav-never", { title: "Never" }, async (s) => {
          await s.offCamera(async (page) => {
            await installFixtureRoutes(page);
            await page.route("**/navigation-b.html", () => undefined);
          });
          await s.open("/navigation-a.html");
          await s.click(s.byTestId("link"));
          await s.hold(300);
        }),
        { arriveWithinMs: 1_500 },
      ),
    ).rejects.toThrow(
      /still on its way to .*navigation-b\.html.*after 1\.5 s/s,
    );
  } finally {
    await browser.close();
  }
});

test("a login hook can use a path, as Playwright's own tests do", async () => {
  const browser = await launchBrowser();
  try {
    let title: string | null = null;
    const config = testConfig({
      auth: {
        login: async (page) => {
          if (page.url().endsWith("/navigation-a.html")) {
            await page.goto("/navigation-b.html");
          }
        },
      },
    });
    await runClip(
      browser,
      config,
      clip("nav-login", { title: "Login" }, async (s) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/navigation-a.html");
        await s.hold(100);
        title = await text(s, "title");
      }),
    );
    expect(title).toBe("Page B");
  } finally {
    await browser.close();
  }
});
