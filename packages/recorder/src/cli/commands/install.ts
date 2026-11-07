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

/** How a run of Playwright's installer ended, and what it said. */
export type Installed = { code: number; output: string };

/**
 * Playwright's installer. `env` is added to this process's environment for
 * that run alone.
 */
export type Installer = (
  command: string,
  args: string[],
  env?: Record<string, string>,
) => Promise<Installed>;

/**
 * Playwright's installer, its output on this terminal as it runs and kept
 * as well, for `fallbackPlatform` to read what it refused. The exit code
 * comes with `close`, not `exit`: the last of the output arrives between
 * the two.
 */
export const runInstaller: Installer = (command, args, env = {}) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    const tee = (to: NodeJS.WriteStream) => (chunk: Buffer) => {
      output += chunk.toString();
      to.write(chunk);
    };
    child.stdout?.on("data", tee(process.stdout));
    child.stderr?.on("data", tee(process.stderr));
    child.on("error", (error) => {
      process.stderr.write(`Could not run the installer: ${error.message}\n`);
      resolve({ code: 1, output });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });

/**
 * The platform to run the installer again as, when Playwright refused this
 * one; null when there is none to try.
 *
 * Playwright knows the Ubuntu releases of its day and refuses a newer one
 * outright, the browser as well as the system libraries: "Playwright does
 * not support chromium-headless-shell on ubuntu26.04-x64". GitHub's
 * ubuntu-latest became 26.04 in October 2026, and Playwright 1.59 says
 * exactly that there. Told through PLAYWRIGHT_HOST_PLATFORM_OVERRIDE that
 * the host is 24.04, the newest it knows, it installs that build and that
 * list of libraries, and the clips record the same (a run of
 * petbul/notify-test on 2026-10-31). Only Ubuntu, and only a newer one: for
 * a distribution Playwright never knew there is no stand-in known to work,
 * and its own message stands.
 */
export function fallbackPlatform(output: string): string | null {
  const refused = /does not support \S+ on ubuntu(\d+)\.(\d+)-([a-z0-9]+)/.exec(
    output,
  );
  if (!refused) return null;
  const [, major, minor, arch] = refused;
  const newer =
    Number(major) > 24 || (Number(major) === 24 && Number(minor) > 4);
  return newer ? `ubuntu24.04-${arch}` : null;
}

/**
 * The installer, and once more as a platform Playwright knows where it
 * refused this one (`fallbackPlatform`), saying so between the two. An
 * override the person set themselves is theirs: nothing second-guesses it.
 */
export async function runWithFallback(
  command: string,
  args: string[],
  io: Pick<InstallerIO, "run" | "write">,
): Promise<number> {
  const first = await io.run(command, args);
  if (first.code === 0 || process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE)
    return first.code;
  const as = fallbackPlatform(first.output);
  if (as === null) return first.code;
  io.write(
    `Playwright ${pinnedPlaywright().version} doesn't support this OS yet, so versioncam installs the build for ${as}, the newest Ubuntu it supports. That build and its libraries record the same here:\n` +
      `  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=${as} ${[command, ...args].join(" ")}\n`,
  );
  return (
    await io.run(command, args, { PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: as })
  ).code;
}

/** What `ensureFullBrowser` touches, so a test can stand in for all of it. */
export type InstallerIO = {
  has: () => boolean;
  run: Installer;
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
    "This command opens a window, which needs the full Chromium. `versioncam install` " +
      "fetched only the headless shell that records.\n" +
      `Downloading the full Chromium once, for Playwright ${playwright.version}:\n` +
      `  ${[command, ...args].join(" ")}\n`,
  );
  return (await runWithFallback(command, args, io)) === 0;
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
      ? `Installing both Chromium builds for Playwright ${playwright.version}: the headless shell that versioncam records with, and the full browser that login and preview open:\n`
      : `Installing the headless Chromium that versioncam records with, for Playwright ${playwright.version}:\n`) +
      `  ${[command, ...args].join(" ")}\n`,
  );
  return runWithFallback(command, args, {
    run: runInstaller,
    write: (text) => process.stdout.write(text),
  });
}
