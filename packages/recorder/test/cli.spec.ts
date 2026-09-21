import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FIXTURE_RECORDING } from "./support.js";

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

/**
 * The same, with one recording already in it, and the beats it claims.
 *
 * The committed fixture recording predates `marks`, which is exactly the shape
 * of every recording made before this feature existed — so the beats are
 * written into the copy rather than re-recorded, and the CLI has to read them
 * from the file the way it will in a consumer's repository.
 */
function appDirWithRecording(
  marks: { frame: number; label: string }[],
): string {
  const dir = appDir();
  const recording = join(dir, ".demos", "recordings", "buttons");
  mkdirSync(dirname(recording), { recursive: true });
  cpSync(FIXTURE_RECORDING, recording, { recursive: true });
  const file = join(recording, "timeline.json");
  const timeline = JSON.parse(readFileSync(file, "utf8")) as object;
  writeFileSync(file, `${JSON.stringify({ ...timeline, marks }, null, 2)}\n`);
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
      "frame",
      "preview",
      "review",
      "inspect",
      "measure",
      "dsl",
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

  test("sheet --at-marks samples the beats, and says which frames", () => {
    const dir = appDirWithRecording([{ frame: 40, label: "after click" }]);
    const { status, stdout } = run(["sheet", "buttons", "--at-marks"], dir);
    expect(status).toBe(0);

    const [sheet, frames] = stdout.trim().split("\n");
    // The path stays on the first line: everything that calls this reads it.
    expect(sheet.endsWith("buttons-sheet.png")).toBe(true);
    expect(existsSync(sheet)).toBe(true);
    // The opening frame, the beat, and the last frame — 115 of them, so 114.
    expect(frames).toBe("frames 0 · 40 · 114");
  });

  test("frame writes one png, by number and by time", () => {
    const dir = appDirWithRecording([]);

    const byNumber = run(["frame", "buttons", "10"], dir);
    expect(byNumber.status).toBe(0);
    const file = byNumber.stdout.trim();
    expect(file.endsWith("buttons-frame-10.png")).toBe(true);
    expect(existsSync(file)).toBe(true);

    // The recording is 60fps, so one second in is frame 60 — and the name says
    // which frame the time turned out to mean.
    const byTime = run(["frame", "buttons", "--t", "1"], dir);
    expect(byTime.status).toBe(0);
    expect(byTime.stdout.trim().endsWith("buttons-frame-60.png")).toBe(true);

    // And a frame the clip does not have is refused by saying what it has.
    const beyond = run(["frame", "buttons", "999"], dir);
    expect(beyond.status).toBe(1);
    expect(beyond.stderr).toContain("0–114");
  });

  test("review reads the recording and its beat sheet, and sets the exit code", () => {
    const dir = appDirWithRecording([
      { frame: 0, label: "open /buttons.html" },
      { frame: 79, label: "after click" },
    ]);
    const beats = join(dir, "beats.json");
    writeFileSync(
      beats,
      `${JSON.stringify([{ label: "after click", expect: "the counter reads 1" }])}\n`,
    );

    // The fixture recording is 1.9s, so the bounds have to say so — which is
    // what they are for.
    const ok = run(
      [
        "review",
        "buttons",
        "--beats",
        "beats.json",
        "--min",
        "1",
        "--max",
        "3",
      ],
      dir,
    );
    expect(ok.stdout).toContain("buttons: PASS");
    expect(ok.stdout).toContain("✓ beats");
    expect(ok.status).toBe(0);

    // A beat nothing marked, at a length nothing asked for: two clauses, both
    // named, and an exit code CI can read.
    writeFileSync(beats, `${JSON.stringify([{ label: "filtered" }])}\n`);
    const bad = run(["review", "buttons", "--beats", "beats.json"], dir);
    expect(bad.stdout).toContain("buttons: FAIL");
    expect(bad.stdout).toContain('"filtered"');
    expect(bad.stdout).toContain("outside 9–11s");
    expect(bad.status).toBe(1);
  });

  test("dsl prints the reference, and it says nothing about drag", () => {
    const { status, stdout } = run(["dsl"], PACKAGE);
    expect(status).toBe(0);
    expect(stdout).toContain("byTestId");
    expect(stdout).toContain("camera.zoom");
    // The method the README promised for months and the session never had.
    expect(stdout).not.toContain("drag(");
  });

  /**
   * `init` copies prompts into a repository, so the interesting behaviour is
   * what it does the second time: a plugin update must never silently discard
   * a file someone has edited.
   */
  test("init --claude installs the plugin's prompts, and will not clobber them", () => {
    const dir = mkdtempSync(join(tmpdir(), "living-demos-init-"));
    const agent = join(dir, ".claude", "agents", "demo-author.md");

    // It needs no config: a repository can install the prompts before it has
    // any clips to write them for.
    expect(run(["init"], dir).status).toBe(1);
    expect(existsSync(agent)).toBe(false);

    const first = run(["init", "--claude"], dir);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(join(".claude", "agents", "demo-author.md"));
    expect(first.stdout).toContain(
      join(".claude", "skills", "demos-author", "SKILL.md"),
    );
    expect(existsSync(join(dir, ".claude", "agents", "demo-reviewer.md"))).toBe(
      true,
    );

    writeFileSync(agent, "edited by hand");

    const second = run(["init", "--claude"], dir);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("demo-author.md");
    expect(second.stderr).toContain("--force");
    expect(readFileSync(agent, "utf8")).toBe("edited by hand");

    const forced = run(["init", "--claude", "--force"], dir);
    expect(forced.status).toBe(0);
    expect(readFileSync(agent, "utf8")).toContain("name: demo-author");
  });
});
