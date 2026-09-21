import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The CLI as a consumer meets it: the built `dist/cli/main.js`, run as a
 * process, in a directory that is not this package.
 *
 * Testing the command functions directly would miss the things that actually
 * break — argument parsing, the config being found relative to the cwd, an
 * exit code that CI can read.
 */
const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(PACKAGE, "dist", "cli", "main.js");

function run(
  args: string[],
  cwd: string,
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

/**
 * A directory shaped like a consumer's repository: the package installed under
 * node_modules, and a config that imports it by name.
 *
 * Importing the package by an absolute path instead would work here and fail
 * for every real user — esbuild only leaves the import alone, for Node to
 * resolve, when the specifier is the bare package name.
 */
function appDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "living-demos-cli-"));
  const scope = join(dir, "node_modules", "@living-demos");
  mkdirSync(scope, { recursive: true });
  symlinkSync(PACKAGE, join(scope, "recorder"), "dir");
  writeFileSync(
    join(dir, "recorder.config.ts"),
    `import { defineRecorder } from "@living-demos/recorder";\n` +
      `export default defineRecorder({ baseUrl: "http://example.test" });\n`,
  );
  return dir;
}

test.describe("the demos CLI", () => {
  test("lists its commands", () => {
    const { status, stdout } = run(["--help"], PACKAGE);
    expect(status).toBe(0);
    for (const command of [
      "record",
      "render",
      "check",
      "sheet",
      "preview",
      "inspect",
      "measure",
      "login",
      "doctor",
    ]) {
      expect(stdout).toContain(`demos ${command}`);
    }
  });

  test("refuses an unknown command, and says so", () => {
    const { status, stderr } = run(["frobnicate"], PACKAGE);
    expect(status).toBe(1);
    expect(stderr).toContain("frobnicate");
  });

  test("doctor passes on a machine that can record", () => {
    const { status, stdout } = run(["doctor"], appDir());
    expect(stdout).toContain("chromium");
    expect(stdout).toContain("ffmpeg");
    // Every check should pass here: this suite only runs where Chromium and
    // ffmpeg already do.
    expect(stdout).not.toContain("✗");
    expect(status).toBe(0);
  });

  test("doctor reports a missing config rather than crashing", () => {
    const empty = mkdtempSync(join(tmpdir(), "living-demos-empty-"));
    const { status, stdout } = run(["doctor"], empty);
    expect(stdout).toContain("✗ config");
    expect(stdout).toContain("recorder.config.ts");
    expect(status).toBe(1);
  });

  test("says what it looked for when a directory has no clips", () => {
    const { status, stderr } = run(["record"], appDir());
    expect(status).toBe(1);
    expect(stderr).toContain("No clips found");
    expect(stderr).toContain("demos/**/*.clip.ts");
  });

  test("says to record first when there is nothing to render", () => {
    const { status, stderr } = run(["render"], appDir());
    expect(status).toBe(1);
    expect(stderr).toContain("demos record");
  });

  test("offers a draft, and says so where the commands are listed", () => {
    expect(run(["--help"], appDir()).stdout).toContain("--draft");
    // The flag is not mistaken for a clip id, which is what `strict: false`
    // parsing gets wrong if the option is not declared.
    const { status, stderr } = run(["record", "--draft"], appDir());
    expect(status).toBe(1);
    expect(stderr).toContain("No clips found");
    expect(stderr).not.toContain("--draft");
  });
});
