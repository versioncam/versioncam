import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
 * The same, without blocking this process.
 *
 * `doctor` asks whether the app answers, and in these tests the app is a
 * server running on this very event loop — which `execFileSync` would hold
 * shut for the whole run, so the CLI would find nothing listening.
 */
const execFileAsync = promisify(execFile);

async function runAsync(
  args: string[],
  cwd: string,
): Promise<{ status: number; stdout: string }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
    });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { code?: number; stdout?: string };
    return { status: e.code ?? 1, stdout: e.stdout ?? "" };
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
function appDir(baseUrl = "http://example.test"): string {
  const dir = mkdtempSync(join(tmpdir(), "living-demos-cli-"));
  const scope = join(dir, "node_modules", "@living-demos");
  mkdirSync(scope, { recursive: true });
  symlinkSync(PACKAGE, join(scope, "recorder"), "dir");
  writeFileSync(
    join(dir, "recorder.config.ts"),
    `import { defineRecorder } from "@living-demos/recorder";\n` +
      `export default defineRecorder({ baseUrl: "${baseUrl}" });\n`,
  );
  return dir;
}

/** A server that answers, so `doctor` has an app to find. */
async function servedDir(
  status = 200,
): Promise<{ dir: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(status);
    response.end("ok");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server.address() as AddressInfo).port;
  return {
    dir: appDir(`http://127.0.0.1:${port}`),
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
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

  test("doctor passes on a machine that can record, with the app up", async () => {
    const app = await servedDir();
    try {
      const { status, stdout } = await runAsync(["doctor"], app.dir);
      expect(stdout).toContain("chromium");
      expect(stdout).toContain("ffmpeg");
      expect(stdout).toContain("HTTP 200");
      // Every check should pass here: this suite only runs where Chromium and
      // ffmpeg already do, and the app is a server this test started.
      expect(stdout).not.toContain("✗");
      expect(status).toBe(0);
    } finally {
      await app.close();
    }
  });

  test("doctor counts a login page as reachable", async () => {
    // An app behind a sign-in answers 401 or redirects, and records perfectly
    // well once `auth` is configured. Only silence means it is not there.
    const app = await servedDir(401);
    try {
      const { status, stdout } = await runAsync(["doctor"], app.dir);
      expect(stdout).toContain("HTTP 401");
      expect(stdout).not.toContain("✗");
      expect(status).toBe(0);
    } finally {
      await app.close();
    }
  });

  test("doctor says when nothing is serving the app", () => {
    // The check an authoring loop leans on: a stopped dev server should be
    // named here, not discovered three minutes later as a missing locator.
    const { status, stdout } = run(["doctor"], appDir());
    expect(stdout).toContain("✗ app");
    expect(stdout).toContain("http://example.test");
    expect(stdout).toContain("Start the app");
    expect(status).toBe(1);
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
