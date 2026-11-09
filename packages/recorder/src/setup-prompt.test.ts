import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The setup prompt is the way in that both READMEs lead with: a paragraph a
 * person pastes into a coding agent, which installs the package and follows
 * the skill to a first clip. It is written out twice, in this package's
 * README (npm's page, and the one version.cam copies its own prompt from)
 * and in the repository's, and it names the install commands that the block
 * under it lists. Nobody reads a prompt they paste, so a copy that drifts
 * sends an agent to a command or a file that does not exist and no person
 * notices. This is the check that the two copies, the commands and the
 * skill's place on disk still agree.
 *
 * It lives in this package because the root runner reads only package
 * sources; one of the two files it reads is the root's.
 */
const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(PACKAGE, "..", "..");

/** The part a person replaces, which version.cam's page also highlights. */
const PLACEHOLDER = "<what the clip should show>";

/** A README's setup prompt as one line, however its lines are wrapped. */
function promptOf(readme: string): string {
  const block = /```text\n(Set up versioncam[\s\S]*?)\n```/.exec(readme);
  if (!block) throw new Error("no setup prompt in this README");
  return block[1].replace(/\s+/g, " ").trim();
}

/** The commands of the `## Install` section's first block, without comments. */
function installCommands(readme: string): string[] {
  const install = readme.split(/^## /m).find((s) => s.startsWith("Install\n"));
  const block = /```bash\n([\s\S]*?)```/.exec(install ?? "");
  if (!block) throw new Error("no install block in the README");
  return block[1]
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter(Boolean);
}

describe("the setup prompt", () => {
  const packageReadme = readFileSync(join(PACKAGE, "README.md"), "utf8");
  const rootReadme = readFileSync(join(ROOT, "README.md"), "utf8");
  const prompt = promptOf(packageReadme);

  it("is the same in the package's README and the repository's", () => {
    expect(promptOf(rootReadme)).toBe(prompt);
  });

  it("names the install commands the README lists, in their order", () => {
    const commands = installCommands(packageReadme);
    expect(commands.length).toBeGreaterThan(0);
    const places = commands.map((command) => prompt.indexOf(`\`${command}\``));
    expect(places).not.toContain(-1);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });

  it("keeps the part a person fills in", () => {
    expect(prompt).toContain(PLACEHOLDER);
  });

  it("sends the agent to the file `init` installs", () => {
    // `init` copies plugin/skills/versioncam/ to .claude/skills/versioncam/.
    expect(prompt).toContain("`.claude/skills/versioncam/`");
    expect(prompt).toContain("`SKILL.md`");
    expect(
      existsSync(join(PACKAGE, "plugin", "skills", "versioncam", "SKILL.md")),
    ).toBe(true);
  });
});
