import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `--cwd <dir>`: run a command as if from `<dir>`.
 *
 * Every command works in the directory that holds `versioncam.config.ts`:
 * the config, `.env.recording` and `.env`, `.versioncam/`, and any relative
 * path a command is given or prints are that directory's. In a monorepo the
 * app is one directory among many, and whatever runs versioncam may be
 * somewhere else: a script at the repository root, or an agent whose session
 * started inside the app, below its config, and which may not `cd` out of
 * the directory it started in.
 *
 * Its own module so a test can reach it without running the CLI.
 */

/**
 * `--cwd <dir>` or `--cwd=<dir>`, taken out of the arguments, from anywhere
 * among them. If it is given twice, the last one counts.
 *
 * Anywhere, not only before the command's name, because what an agent may
 * run is a prefix: the reviewer is allowed `npx versioncam frame *` and
 * nothing else, so its flag has to be able to come after `frame`.
 */
export function takeCwd(argv: string[]): {
  cwd: string | undefined;
  rest: string[];
} {
  let cwd: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== "--cwd" && !arg.startsWith("--cwd=")) {
      rest.push(arg);
      continue;
    }
    const value = arg === "--cwd" ? argv[++i] : arg.slice("--cwd=".length);
    // A flag where the directory should be is a directory left out, not a
    // directory called `--draft`.
    if (!value || value.startsWith("-")) {
      throw new Error(
        "`--cwd` needs a directory: versioncam <command> --cwd <dir>",
      );
    }
    cwd = value;
  }
  return { cwd, rest };
}

/**
 * The versioncam a config in `dir` imports: the first `node_modules/versioncam`
 * from `dir` up, which is where Node looks for a bare `import "versioncam"`.
 * Null where there is none.
 *
 * Resolved through symlinks, so an `npm link` or a pnpm store compares as
 * the directory it really is.
 */
export function versioncamFrom(dir: string): string | null {
  for (let at = resolve(dir); ; at = dirname(at)) {
    const candidate = join(at, "node_modules", "versioncam");
    if (existsSync(join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    if (dirname(at) === at) return null;
  }
}

/** This package, where it really is: two levels above this file. */
const RUNNING = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
);

/** "versioncam 0.1.3 in <dir>", without the version if it cannot be read. */
function nameOf(pkg: string): string {
  try {
    const { version } = JSON.parse(
      readFileSync(join(pkg, "package.json"), "utf8"),
    ) as { version?: string };
    if (version) return `versioncam ${version} in ${pkg}`;
  } catch {
    // Named by its directory alone, which is the part that matters.
  }
  return `versioncam in ${pkg}`;
}

/**
 * Move into `dir` for the rest of the command, or say why not.
 *
 * Only the directory moves, though, and not the versioncam running: `npx`
 * finds the binary in the directory it runs in and in those above it, never
 * below. Run from above an app that has versioncam in its own
 * `node_modules`, it runs another copy, or downloads the latest one, and that
 * copy would record with a Chromium the app never pinned, beside a config
 * that imports the app's own. So a directory whose own versioncam is not the
 * one running is refused, with how to run its own.
 */
export function enterCwd(dir: string): void {
  const target = resolve(dir);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`\`--cwd ${dir}\`: there is no directory ${target}.`);
  }

  const theirs = versioncamFrom(target);
  if (theirs !== null && theirs !== RUNNING) {
    const shown = relative(process.cwd(), target) || ".";
    throw new Error(
      `\`--cwd ${dir}\`: that directory has its own ${nameOf(theirs)}, ` +
        `and this is ${nameOf(RUNNING)}.\n` +
        "npx looks for versioncam in the directory it runs in and in those above it, never below.\n" +
        `Run the directory's own instead: cd ${shown}, then the same command without --cwd.`,
    );
  }

  process.chdir(target);
}
