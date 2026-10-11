import { expect, test } from "@playwright/test";
import type { Browser } from "playwright";
import { clip, runClip } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * CSS animations end, so what waits for them runs.
 *
 * The recorder pauses every CSS animation and scrubs it to authored time. A
 * paused animation never resolves its `finished` promise and never fires
 * `animationend`, so a component that unmounts once its exit animation has
 * finished stayed mounted: Base UI's dialog backdrop, closed and scrubbed to
 * opacity 0, sat over the page and took the next click (0.5.0, found
 * recording Vpogled's clips). A finite animation whose time is up is
 * finished now, the way it ends in a browser nobody is filming; one that
 * repeats forever stays scrubbed.
 */

/** Whether the backdrop is still in the document. */
const backdropMounted = (s: RecordingSession): Promise<boolean> =>
  s.offCamera((page) =>
    page.evaluate(() => document.getElementById("backdrop") !== null),
  );

const statusOf = (s: RecordingSession): Promise<string> =>
  s.offCamera((page) =>
    page.evaluate(() => document.getElementById("status")?.textContent ?? ""),
  );

test.describe("CSS animations on the clip's clock", () => {
  let browser: Browser;
  test.beforeAll(async () => {
    browser = await launchBrowser();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  for (const unmount of ["finished", "animationend"]) {
    test(`a dialog that unmounts on ${unmount} leaves, and the link under it takes the next click`, async () => {
      let mountedAfterClose = true;
      let status = "";
      let spinning = 0;
      await runClip(
        browser,
        testConfig(),
        clip(`dialog-${unmount}`, { title: "Dialogs" }, async (s) => {
          await s.offCamera(installFixtureRoutes);
          await s.open(`/dialogs.html?unmount=${unmount}`);
          await s.click(s.byTestId("close"));
          await s.settle();
          mountedAfterClose = await backdropMounted(s);
          await s.click(s.byTestId("link"));
          await s.settle();
          status = await statusOf(s);
          // The spinner repeats forever: it is still there, still scrubbed.
          spinning = await s.offCamera((page) =>
            page.evaluate(
              () =>
                document.getElementById("spinner")?.getAnimations().length ?? 0,
            ),
          );
        }),
      );
      expect(mountedAfterClose).toBe(false);
      expect(status).toBe("arrived");
      expect(spinning).toBe(1);
    });
  }
});
