import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

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
 * Both Chromium builds, deliberately: recording is headless and uses the
 * headless shell, while `login` and `preview` open a window a person uses
 * and need the full browser.
 */
export function installArgv(
  node: string,
  cli: string,
  withDeps: boolean,
): string[] {
  return [
    node,
    cli,
    "install",
    ...(withDeps ? ["--with-deps"] : []),
    "chromium",
  ];
}

/**
 * Install the Chromium this version of versioncam records with.
 *
 * `--with-deps` adds the system libraries Chromium needs on a bare Linux
 * image, which is the usual state of a CI runner and asks for root there.
 * The command it runs is printed first: in a CI log, which Playwright
 * installed which browser is the first question when something differs.
 */
export async function install(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { "with-deps": { type: "boolean" } },
    strict: false,
  });
  const playwright = pinnedPlaywright();
  const [command, ...args] = installArgv(
    process.execPath,
    playwright.cli,
    values["with-deps"] === true,
  );
  process.stdout.write(
    `Chromium for Playwright ${playwright.version}, the version versioncam records with:\n` +
      `  ${[command, ...args].join(" ")}\n`,
  );
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (error) => {
      process.stderr.write(`Could not run the installer: ${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
