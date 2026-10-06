import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "./init.js";

/** The skill as this package ships it, beside `dist/` and `src/`. */
const SKILL = new URL("../../../plugin/skills/versioncam/", import.meta.url);

/** `init` in an empty directory, with what it printed. */
async function initIn(argv: string[]): Promise<{ dir: string; out: string }> {
  const dir = mkdtempSync(join(tmpdir(), "versioncam-init-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  const out: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  expect(await init(argv)).toBe(0);
  return { dir, out: out.join("") };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versioncam init", () => {
  // The platform's brief is what `/versioncam status`, `fix` and `embed`
  // read: a skill installed without it would send an agent to a file that
  // is not there.
  it("installs the platform brief beside the skill's other briefs", async () => {
    const { dir, out } = await initIn([]);
    const installed = join(dir, ".claude", "skills", "versioncam");
    for (const file of [
      "SKILL.md",
      "authoring.md",
      "onboarding.md",
      "platform.md",
    ]) {
      expect(existsSync(join(installed, file)), file).toBe(true);
      expect(out).toContain(join(".claude", "skills", "versioncam", file));
    }
    expect(readFileSync(join(installed, "platform.md"), "utf8")).toBe(
      readFileSync(new URL("platform.md", SKILL), "utf8"),
    );
    // And the skill sends the agent there.
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toContain(
      "Read `platform.md`",
    );
  });

  it("puts it where --into says, too", async () => {
    const { dir } = await initIn(["--into", "agent-skills"]);
    expect(
      existsSync(join(dir, "agent-skills", "versioncam", "platform.md")),
    ).toBe(true);
  });
});
