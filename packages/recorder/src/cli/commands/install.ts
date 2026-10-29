import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { registry } from "playwright-core/lib/server";

/**
 * The Playwright this package drives: its version, and the CLI that ships
 * with it.
 *
 * Resolved from versioncam's own dependency rather than the app's, because
 * they need not agree. Playwright is pinned exactly here — a new Chromium
 * changes every captured pixel, so an upgrade is an event with a changelog
 * entry, never a range — while the app may have a Playwright of its own for
 * its tests, at any version. `npx playwright install` resolves the app's and
 * installs the Chromium *it* expects, which is how a machine ends up with a
 * browser and `doctor` still saying there is none.
 */
export function pinnedPlaywright(): { version: string; cli: string } {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("playwright/package.json");
  const { version } = require(manifest) as { version: string };
  return { version, cli: join(dirname(manifest), "cli.js") };
}

/**
 * The command `versioncam install` runs, as argv.
 *
 * The headless shell alone, unless asked for more. It is the Chromium that
 * records: Playwright launches it for every headless run, and every recorder
 * command but two is headless. It is also 190 MB where the full browser is
 * 340 MB more, and a stranger's first ten minutes with the package were
 * measured on 2026-10-28: on a slow line the two builds together took nine of
 * them. `login` and `preview` open a window, which the shell cannot, so they
 * fetch the full browser the first time they run; `--full` fetches both now,
 * for a machine that will be offline then.
 */
export function installArgv(
  node: string,
  cli: string,
  options: { withDeps?: boolean; full?: boolean } = {},
): string[] {
  return [
    node,
    cli,
    "install",
    ...(options.withDeps ? ["--with-deps"] : []),
    ...(options.full ? [] : ["--only-shell"]),
    "chromium",
  ];
}

/** The command that fetches the full browser alone, the shell being there. */
export function fullBrowserArgv(node: string, cli: string): string[] {
  return [node, cli, "install", "--no-shell", "chromium"];
}

/**
 * Where the two Chromium builds this version uses are, or null for one that
 * is not there.
 *
 * Asked of Playwright's own registry, which knows the build numbers and
 * honours PLAYWRIGHT_BROWSERS_PATH; the public API names only the full
 * browser's path. `lib/server` is not public API, which the exact pin on
 * Playwright makes bearable: an upgrade is an event, and the tests ask the
 * registry this question too.
 */
export function browserPaths(): { shell: string | null; full: string | null } {
  const where = (name: string): string | null => {
    const found = registry.findExecutable(name)?.executablePath();
    return found && existsSync(found) ? found : null;
  };
  return { shell: where("chromium-headless-shell"), full: where("chromium") };
}

/** Playwright's installer, with its output on this terminal; its exit code. */
export function runInstaller(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (error) => {
      process.stderr.write(`Could not run the installer: ${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** What `ensureFullBrowser` touches, so a test can stand in for all of it. */
export type InstallerIO = {
  has: () => boolean;
  run: (command: string, args: string[]) => Promise<number>;
  write: (text: string) => void;
};

/**
 * Before a command opens a window: the full browser, fetched once if `install`
 * left it out. It says what it is doing first, since a download of a third of
 * a gigabyte with no word on the terminal looks like a hang.
 */
export async function ensureFullBrowser(
  io: InstallerIO = {
    has: () => browserPaths().full !== null,
    run: runInstaller,
    write: (text) => process.stdout.write(text),
  },
): Promise<boolean> {
  if (io.has()) return true;
  const playwright = pinnedPlaywright();
  const [command, ...args] = fullBrowserArgv(process.execPath, playwright.cli);
  io.write(
    "This opens a window, which needs the full Chromium; `versioncam install` " +
      "fetched only the headless shell that records.\n" +
      `Fetching it once, for Playwright ${playwright.version}:\n` +
      `  ${[command, ...args].join(" ")}\n`,
  );
  return (await io.run(command, args)) === 0;
}

/**
 * Install the Chromium this version of versioncam records with.
 *
 * `--with-deps` adds the system libraries Chromium needs on a bare Linux
 * image, which is the usual state of a CI runner and asks for root there.
 * `--full` adds the browser `login` and `preview` open. The command it runs
 * is printed first: in a CI log, which Playwright installed which browser is
 * the first question when something differs.
 */
export async function install(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { "with-deps": { type: "boolean" }, full: { type: "boolean" } },
    strict: false,
  });
  const playwright = pinnedPlaywright();
  const full = values.full === true;
  const [command, ...args] = installArgv(process.execPath, playwright.cli, {
    withDeps: values["with-deps"] === true,
    full,
  });
  process.stdout.write(
    (full
      ? `Both Chromium builds for Playwright ${playwright.version}: the headless shell versioncam records with, and the browser login and preview open:\n`
      : `The headless Chromium versioncam records with, for Playwright ${playwright.version}:\n`) +
      `  ${[command, ...args].join(" ")}\n`,
  );
  return runInstaller(command, args);
}
