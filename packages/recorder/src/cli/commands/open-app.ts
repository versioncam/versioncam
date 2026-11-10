import { spawnSync } from "node:child_process";
import type { Browser, BrowserContext, Page } from "playwright";
import type { ResolvedConfig } from "../../config.js";
import { sendHeaders } from "../../driver/headers.js";
import { MUTATION_COUNTER_SCRIPT } from "../../driver/page-hooks.js";
import { settlePage } from "../../driver/settle.js";

/**
 * `--viewport 390x844`, checked.
 *
 * For a clip with a size of its own, a phone clip above all: an app's phone
 * layout has controls its desktop layout does not, a menu button and what is
 * behind it, and a clip cannot be written from a listing of the wrong one.
 */
export function viewportOf(
  value: string | boolean | undefined,
): { width: number; height: number } | undefined | Error {
  if (value === undefined) return undefined;
  const match = typeof value === "string" && /^(\d+)x(\d+)$/.exec(value);
  if (match && Number(match[1]) > 0 && Number(match[2]) > 0) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return new Error(
    `--viewport is width by height, as in 390x844, got ${JSON.stringify(value)}.`,
  );
}

/** A Windows path, which no page of an app ever begins with. */
const DRIVE = /^[A-Za-z]:[\\/]/;

/**
 * The page a command-line argument meant, on Windows.
 *
 * Git Bash, where Claude Code runs commands on Windows, rewrites an argument that
 * begins with a slash before node sees it: `inspect /settings` arrives as
 * `C:/Program Files/Git/settings`. So the skill's first look at an app would ask
 * for `http://localhost:3000C:/Program Files/Git/`. What was rewritten can be put
 * back, given the root it was prefixed with; `gitBashRoot` is that question, and
 * only asked of a path that needs it. Anything else with a drive letter is stopped
 * here with what to do, since no browser would make sense of it.
 */
export function pageFromArgument(
  path: string,
  gitBashRoot: () => string | null,
): string {
  if (!DRIVE.test(path)) return path;
  const asked = gitBashRoot();
  const root = asked && (asked.endsWith("/") ? asked : `${asked}/`);
  const forward = path.replaceAll("\\", "/");
  if (root && forward.toLowerCase().startsWith(root.toLowerCase())) {
    return `/${forward.slice(root.length)}`;
  }
  throw new Error(
    `"${path}" is not a page of the app. Git Bash rewrites an argument that ` +
      "begins with a slash: set MSYS_NO_PATHCONV=1 for this command, or run it " +
      "from PowerShell.",
  );
}

/** Where Git Bash's `/` is, from its own tool, or null outside Git Bash. */
function gitBashRoot(): string | null {
  const answer = spawnSync("cygpath", ["-m", "/"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return answer.status === 0 ? answer.stdout.trim() : null;
}

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
  viewport: { width: number; height: number } = config.viewport,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    // As a clip's context has it, so a login hook works the same in both.
    baseURL: config.baseUrl,
    viewport,
    deviceScaleFactor: config.dpr,
    timezoneId: config.clock.timezoneId,
    locale: config.clock.locale,
    storageState: config.auth?.storageState,
  });
  await sendHeaders(context, config.headers);
  const page = await context.newPage();
  await page.addInitScript(MUTATION_COUNTER_SCRIPT);

  let inFlight = 0;
  page.on("request", () => (inFlight += 1));
  page.on("requestfinished", () => (inFlight = Math.max(0, inFlight - 1)));
  page.on("requestfailed", () => (inFlight = Math.max(0, inFlight - 1)));

  const asked =
    process.platform === "win32" ? pageFromArgument(path, gitBashRoot) : path;
  const url = asked.startsWith("http") ? asked : `${config.baseUrl}${asked}`;
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
