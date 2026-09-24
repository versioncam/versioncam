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

/** What WP5's `init --claude` wrote, which the new skill replaces. */
const OLD_INSTALL = [
  join(".claude", "skills", "demos-author"),
  join(".claude", "agents", "demo-author.md"),
  join(".claude", "agents", "demo-reviewer.md"),
];

/** Every file under `dir`, as paths relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

/**
 * Install the skill, and nothing else.
 *
 * The skill is the whole product surface for an agent: one directory — the
 * orchestration, the authoring brief, the first-run brief — and the reviewer's
 * file. No config stub, because the first run writes the real one from the
 * repository, and a stub is a config somebody has to finish by hand.
 *
 * By default into `.claude/`, where Claude Code finds both: the skill under
 * `skills/versioncam/`, the reviewer under `agents/`, where it registers as an
 * agent whose tools are limited to looking. `--into <dir>` is for a host that
 * reads skills from elsewhere — which path that is gets checked against the
 * host's own documentation by whoever needs it, not guessed here — and there
 * the reviewer goes inside the skill's directory, where the skill looks for it
 * on a host that cannot register agents.
 *
 * It refuses to overwrite rather than merging, and it refuses *everything* if
 * any one destination exists. A half-installed set is the bad outcome: a new
 * skill beside an old reviewer file fails in the middle of a round instead of
 * at the copy. And the prompts are the part of this package people most want
 * to edit, so a second `init` must never silently discard their edits.
 */
export async function init(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      force: { type: "boolean", default: false },
      into: { type: "string" },
      claude: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.claude === true) {
    process.stderr.write(
      "`--claude` is gone: `versioncam init` installs into .claude/ by default, and `--into <dir>` puts the skill somewhere else.\n",
    );
    return 1;
  }

  const skillDir = join(PLUGIN_DIR, "skills", "versioncam");
  const reviewer = join(PLUGIN_DIR, "agents", "versioncam-reviewer.md");
  if (!existsSync(skillDir) || !existsSync(reviewer)) {
    process.stderr.write(
      `No skill at ${skillDir}.\n` +
        "Reinstall versioncam, or run this from an installed copy.\n",
    );
    return 1;
  }

  const cwd = process.cwd();
  const into = values.into as string | undefined;
  const skillTarget = into
    ? resolve(cwd, into, "versioncam")
    : join(cwd, ".claude", "skills", "versioncam");
  const reviewerTarget = into
    ? join(skillTarget, "versioncam-reviewer.md")
    : join(cwd, ".claude", "agents", "versioncam-reviewer.md");

  const copies = (await filesUnder(skillDir)).map((file) => ({
    from: join(skillDir, file),
    to: join(skillTarget, file),
  }));
  copies.push({ from: reviewer, to: reviewerTarget });

  const existing = copies.filter((c) => existsSync(c.to));
  if (existing.length > 0 && values.force !== true) {
    process.stderr.write(
      `Already there:\n` +
        existing.map((c) => `  ${relative(cwd, c.to)}\n`).join("") +
        "Nothing was copied. Pass --force to overwrite.\n",
    );
    return 1;
  }

  for (const { from, to } of copies) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    process.stdout.write(`${relative(cwd, to)}\n`);
  }

  if (into) {
    process.stdout.write(
      `\nThe reviewer is ${relative(cwd, reviewerTarget)}. A host that can register agents should register it as versioncam-reviewer; one that cannot, the skill reads it from there.\n`,
    );
  }

  // Two skills answering the same request is worse than either alone.
  const old = OLD_INSTALL.filter((path) => existsSync(join(cwd, path)));
  if (old.length > 0) {
    process.stdout.write(
      `\nAn older install is still here, and replaced by this one — remove it:\n` +
        old.map((path) => `  ${path}\n`).join(""),
    );
  }

  process.stdout.write(
    `\nInstalled. Ask your agent: /versioncam "<what the clip should show>"\n` +
      "The first run sets this repository up.\n",
  );
  return 0;
}
