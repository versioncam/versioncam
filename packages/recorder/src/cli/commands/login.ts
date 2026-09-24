import { launchBrowser } from "../../driver/launch.js";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "../../loader.js";
import { drivingApp } from "../app.js";

/**
 * Sign in once, by hand, and keep the session.
 *
 * Every app authenticates differently, and scripting a sign-in means putting
 * credentials somewhere a recorder can read them. A saved browser session
 * avoids both: a person signs in the way they always do, and recordings reuse
 * the result. It is still a credential — the config's path should be
 * gitignored, and it is inside the recorder's own output directory by default.
 */
export async function login(): Promise<number> {
  const config = await loadConfig(process.cwd());
  const auth = config.auth;

  if (!auth?.storageState) {
    process.stderr.write(
      '`versioncam login` needs `auth: { storageState: "..." }` in the config.\n' +
        "An app that signs in with a `login` hook does not need this command.\n",
    );
    return 1;
  }

  const storageState = auth.storageState;
  return drivingApp(config, async () => {
    const browser = await launchBrowser({ headless: false });
    try {
      const context = await browser.newContext({ viewport: config.viewport });
      const page = await context.newPage();
      await page.goto(config.baseUrl);

      process.stdout.write(
        `Sign in to ${config.baseUrl} in the window that opened.\n` +
          "Press Enter here when you are done. ",
      );
      await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.once("data", () => {
          process.stdin.pause();
          resolve();
        });
      });

      await mkdir(dirname(storageState), { recursive: true });
      await context.storageState({ path: storageState });
    } finally {
      await browser.close();
    }

    process.stdout.write(`\nSaved the session to ${storageState}\n`);
    return 0;
  });
}
