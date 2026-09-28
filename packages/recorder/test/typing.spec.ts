import { expect, test } from "@playwright/test";
import { clip, runClip } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { RecordingSession } from "../src/driver/session.js";
import { installFixtureRoutes, testConfig } from "./support.js";

/**
 * Everything `type` types has been typed when it returns.
 *
 * Its keystrokes are queued at a human cadence and the driver advances frame
 * by frame, running what is due. The last keystroke is due at the very end,
 * and whenever that end fell between two frames the driver stopped at the
 * earlier one and left it in the queue — so whatever the clip did next went
 * first. A PathGen clip typed "What do these resemble globally?", pressed
 * Enter, and the chat sent it without the question mark. Whether a given
 * message lost its last character depended only on where its timing landed,
 * so the test sends several and expects every one whole.
 */
test("Enter after typing sends everything that was typed", async () => {
  test.setTimeout(120_000);
  const messages = [
    "What do these resemble globally?",
    "What does WHO guidance say about rpoB S450L?",
    "Show me the cluster",
    "Filter to 2023",
    "Why?",
    "Compare with the world.",
  ];
  const browser = await launchBrowser();
  try {
    let sent: string[] = [];
    const typing = clip(
      "typed-then-sent",
      {
        title: "Typed, then sent",
        viewport: { width: 600, height: 200 },
        seed: 7,
      },
      async (s: RecordingSession) => {
        await s.offCamera(installFixtureRoutes);
        await s.open("/composer.html");
        await s.hold(100);
        for (const message of messages) {
          await s.typeInto(s.byLabel("Message"), message);
          await s.press("Enter");
          await s.hold(50);
        }
        sent = await s.offCamera((page) =>
          page.evaluate(() => JSON.parse(document.body.dataset.sent ?? "[]")),
        );
      },
    );
    await runClip(browser, testConfig(), typing);
    expect(sent).toEqual(messages);
  } finally {
    await browser.close();
  }
});
