import type { Browser, BrowserContext, Page } from "playwright";
import type { ResolvedConfig } from "../../config.js";
import { MUTATION_COUNTER_SCRIPT } from "../../driver/page-hooks.js";
import { settlePage } from "../../driver/settle.js";

/**
 * Open the app the way a clip would, minus the capture.
 *
 * The inspection commands have to see the page in the state a clip would find
 * it in — signed in, settled — or their inventory describes a loading screen.
 * The freeze script is deliberately not installed: a person looking at the
 * page wants it behaving normally.
 */
export async function openAppPage(
  browser: Browser,
  config: ResolvedConfig,
  path: string,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: config.dpr,
    timezoneId: config.clock.timezoneId,
    locale: config.clock.locale,
    storageState: config.auth?.storageState,
  });
  const page = await context.newPage();
  await page.addInitScript(MUTATION_COUNTER_SCRIPT);

  let inFlight = 0;
  page.on("request", () => (inFlight += 1));
  page.on("requestfinished", () => (inFlight = Math.max(0, inFlight - 1)));
  page.on("requestfailed", () => (inFlight = Math.max(0, inFlight - 1)));

  const url = path.startsWith("http") ? path : `${config.baseUrl}${path}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  if (config.auth?.login) await config.auth.login(page);

  await settlePage(page, () => inFlight, {
    label: "inspect",
    quietMs: config.settle.quietMs,
    // A cold open, not a mid-clip wait, so it gets a cold open's budget — the
    // same ninety seconds `open()` allows. The general `settle.timeoutMs` is
    // fifteen, which a map app exceeds every single time: `inspect` then warned
    // "timed out, still waiting on hook" on every call and returned complete,
    // correct data anyway. An agent using it second-guessed that data for
    // several calls before trusting it, which is a fair reading of a message
    // that says a thing failed when it did not.
    timeoutMs: 90_000,
    yieldMs: config.settle.yieldMs,
    hook: config.settle.ready ? () => config.settle.ready!(page) : undefined,
  });

  return { page, context };
}
