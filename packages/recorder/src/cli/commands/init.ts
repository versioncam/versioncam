import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The plugin directory inside this package, as installed.
 *
 * `dist/cli/commands/init.js` sits three levels under the package root, and
 * `plugin/` is shipped beside `dist/` by the `files` list in package.json.
 */
const PLUGIN_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "plugin",
);

/** Every file under `dir`, as paths relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

/**
 * Copy the authoring skill and its agents into this repository's `.claude/`.
 *
 * `claude --plugin-dir node_modules/versioncam/plugin` loads the
 * same files without copying anything, and is the better default. This exists
 * for the other case: prompts are the part of this package people most want to
 * change, and a copy in `.claude/` is a file they can edit, diff and commit
 * alongside their clips.
 *
 * It refuses to overwrite rather than merging, and it refuses *everything* if
 * any one destination exists. A half-installed set is the bad outcome: the
 * skill spawns its agents by name, so a new skill beside an old agent file
 * fails in the middle of a round instead of at the copy.
 */
export async function init(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      claude: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.claude !== true) {
    process.stderr.write(
      "Usage: versioncam init --claude\n" +
        "Copies the authoring skill and agents into .claude/ for Claude Code.\n",
    );
    return 1;
  }

  if (!existsSync(PLUGIN_DIR)) {
    process.stderr.write(
      `No plugin directory at ${PLUGIN_DIR}.\n` +
        "Reinstall versioncam, or run this from an installed copy.\n",
    );
    return 1;
  }

  const cwd = process.cwd();
  const copies: { from: string; to: string }[] = [];
  for (const group of ["agents", "skills"]) {
    const source = join(PLUGIN_DIR, group);
    if (!existsSync(source)) continue;
    for (const file of await filesUnder(source)) {
      copies.push({
        from: join(source, file),
        to: join(cwd, ".claude", group, file),
      });
    }
  }

  if (copies.length === 0) {
    process.stderr.write(
      `Nothing to copy: ${PLUGIN_DIR} has no agents or skills.\n`,
    );
    return 1;
  }

  const existing = copies.filter((c) => existsSync(c.to));
  if (existing.length > 0 && values.force !== true) {
    process.stderr.write(
      `Already there:\n` +
        existing.map((c) => `  ${relative(cwd, c.to)}\n`).join("") +
        "Pass --force to overwrite.\n",
    );
    return 1;
  }

  for (const { from, to } of copies) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    process.stdout.write(`${relative(cwd, to)}\n`);
  }

  process.stdout.write(
    `\nRestart Claude Code, then run /versioncam "<what the clip should show>".\n`,
  );
  return 0;
}
