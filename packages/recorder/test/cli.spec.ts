import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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
  env: Record<string, string> = {},
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [CLI, ...args],
      { cwd, encoding: "utf8", env: { ...process.env, ...env } },
    );
    return { status: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return {
      status: e.code ?? 1,
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
function appDir(baseUrl = "http://example.test", fields = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "versioncam-cli-"));
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(PACKAGE, join(dir, "node_modules", "versioncam"), "dir");
  writeFileSync(
    join(dir, "versioncam.config.ts"),
    `import { defineRecorder } from "versioncam";\n` +
      `export default defineRecorder({ baseUrl: "${baseUrl}"${fields} });\n`,
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
  const recording = join(dir, ".versioncam", "recordings", "buttons");
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
    // A document, not a body of text: without a content type the browser may
    // treat the response as a download, and a download never fires
    // `domcontentloaded`, so a clip opening this page waits out its timeout.
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>served</title><p>ok</p>");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server.address() as AddressInfo).port;
  return {
    dir: appDir(`http://127.0.0.1:${port}`),
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** A port nothing is listening on, from the kernel. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

/** Whether anything accepts a connection on the port. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/**
 * A consumer whose config knows how to start its app, and an app that is not
 * running: the shape of a repository after `versioncam init` and a first run.
 * The "dev server" is one line of Node, run through a shell the way `npm run
 * dev` would be.
 */
async function startableDir(
  page = "<!doctype html><title>started</title><p>ok</p>",
): Promise<{ dir: string; port: number }> {
  const port = await freePort();
  // The page is a file the server reads on every request, rather than a
  // string inside the command: HTML inside JavaScript inside a shell command
  // inside a config file is four kinds of quoting for one test.
  const script =
    `require('http').createServer((q, s) => {` +
    ` s.writeHead(200, { 'Content-Type': 'text/html' });` +
    ` s.end(require('fs').readFileSync('page.html')); })` +
    `.listen(${port}, '127.0.0.1')`;
  const command = JSON.stringify(`"${process.execPath}" -e "${script}"`);
  const dir = appDir(
    `http://127.0.0.1:${port}`,
    `, webServer: { command: ${command} }`,
  );
  writeFileSync(join(dir, "page.html"), page);
  return { dir, port };
}

/** A clip that opens the page and looks at it: enough to compare two runs. */
function writeOpenClip(dir: string): void {
  mkdirSync(join(dir, "demos"), { recursive: true });
  writeFileSync(
    join(dir, "demos", "open.clip.ts"),
    [
      'import { clip } from "versioncam";',
      'export default clip("open", { title: "Open" }, async (s) => {',
      '  await s.open("/");',
      "  await s.hold(300);",
      "});",
    ].join("\n"),
  );
}

test.describe("the versioncam CLI", () => {
  test("lists its commands", () => {
    const { status, stdout } = run(["--help"], PACKAGE);
    expect(status).toBe(0);
    for (const command of [
      "record",
      "render",
      "check",
      "stability",
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
      expect(stdout).toContain(`versioncam ${command}`);
    }
    expect(stdout).toContain("--cwd <dir>");
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
    const empty = mkdtempSync(join(tmpdir(), "versioncam-empty-"));
    const { status, stdout } = run(["doctor"], empty);
    expect(stdout).toContain("✗ config");
    expect(stdout).toContain("versioncam.config.ts");
    // And says how to get one: in a fresh app this is the first thing a new
    // user reads, and writing the config by hand is the long way round.
    expect(stdout).toContain("npx versioncam init");
    expect(stdout).toContain("defineRecorder()");
    expect(status).toBe(1);
  });

  test("a command run where there is no config says how to get one", () => {
    const empty = mkdtempSync(join(tmpdir(), "versioncam-empty-"));
    const { status, stderr } = run(["check"], empty);
    expect(stderr).toContain("No versioncam.config.ts");
    expect(stderr).toContain("npx versioncam init");
    expect(status).not.toBe(0);
  });

  test("doctor starts the app through webServer, and stops it again", async () => {
    // The rehearsal for every other command: a start command that is wrong
    // should be found here, not halfway into a clip.
    const { dir, port } = await startableDir();
    const { status, stdout } = await runAsync(["doctor"], dir);
    expect(stdout).toMatch(
      /✓ app +started with ".*", HTTP 200 after .* \(stopped again\)/,
    );
    expect(status).toBe(0);
    expect(await listening(port)).toBe(false);
  });

  test("a command that started the app leaves nothing running", async () => {
    const { dir, port } = await startableDir();
    writeOpenClip(dir);
    const { status, stdout, stderr } = await runAsync(
      ["record", "--draft", "open"],
      dir,
    );
    expect(stderr).toContain("app: started with");
    expect(stdout).toContain("open (draft)");
    expect(status).toBe(0);
    expect(await listening(port)).toBe(false);
  });

  test("in CI, a server already on the port is refused, not reused", async () => {
    // On a developer's machine the server that is up is theirs; on a CI
    // runner, one that was up before the job started is not the build under
    // test.
    const { dir, port } = await startableDir();
    const squatter = createServer((_request, response) => response.end());
    await new Promise<void>((ready) =>
      squatter.listen(port, "127.0.0.1", ready),
    );
    try {
      const { status, stdout } = await runAsync(["doctor"], dir, { CI: "1" });
      expect(stdout).toContain("✗ app");
      expect(stdout).toContain(`port ${port}`);
      expect(status).toBe(1);

      const reused = await runAsync(["doctor"], dir, { CI: "" });
      expect(reused.stdout).toContain("already serving at");
      expect(reused.status).toBe(0);
    } finally {
      await new Promise<void>((done) => squatter.close(() => done()));
    }
  });

  test("stability records a clip twice and calls a steady page stable", async () => {
    const { dir, port } = await startableDir();
    writeOpenClip(dir);
    const { status, stdout } = await runAsync(["stability", "open"], dir);
    expect(stdout).toMatch(/open: run 1 vs run 2 · (\d+) frames, \1 identical/);
    expect(stdout.trim().split("\n").at(-1)).toBe("stable");
    expect(status).toBe(0);
    // Beside the clip's own recording, never over it.
    expect(
      existsSync(
        join(dir, ".versioncam", "recordings", "__stability", "run-2", "open"),
      ),
    ).toBe(true);
    expect(await listening(port)).toBe(false);
  });

  test("stability shows what differs on a page that is not on authored time", async () => {
    // The recorder fakes the clock, so a date on the page is the same every
    // run. A random number is not, which is the shape of the real failures:
    // something the app does that nothing in the recorder drives.
    const { dir } = await startableDir(
      "<!doctype html><title>random</title>" +
        '<p id="id" style="font: 40px sans-serif"></p>' +
        "<script>document.getElementById('id').textContent = crypto.randomUUID();</script>",
    );
    writeOpenClip(dir);
    const { status, stdout } = await runAsync(["stability", "open"], dir);
    expect(stdout).toContain("first difference at frame 0");
    expect(stdout.trim().split("\n").at(-1)).toBe(
      "unstable: something on this page does not run on authored time",
    );
    expect(status).toBe(1);
    // The two pictures, named by frame and run, with the extension the
    // recording's own state images have.
    const files = stdout
      .split("\n")
      .filter((line) => line.startsWith("  "))
      .map((line) => line.trim());
    expect(files).toEqual([
      expect.stringMatching(
        /^\.versioncam\/stability\/open\/frame-0-run1\.\w+$/,
      ),
      expect.stringMatching(
        /^\.versioncam\/stability\/open\/frame-0-run2\.\w+$/,
      ),
    ]);
    for (const file of files) expect(existsSync(join(dir, file))).toBe(true);
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
    expect(stderr).toContain("versioncam record");
  });

  test("a failure names the picture of it", async () => {
    // The message says what broke; the screenshot says why. An authoring agent
    // spent two of three attempts reasoning about causes for a failure that
    // was obvious in one look at the file — which it had been told to read,
    // and which nothing at the moment of failure mentioned.
    const { dir, close } = await servedDir();
    try {
      mkdirSync(join(dir, "demos"), { recursive: true });
      writeFileSync(
        join(dir, "demos", "broken.clip.ts"),
        [
          'import { clip } from "versioncam";',
          'export default clip("broken", { title: "Broken" }, async (s) => {',
          '  await s.open("/");',
          '  await s.click(s.byTestId("no-such-control"));',
          "});",
        ].join("\n"),
      );
      // Async, not `run`: `execFileSync` blocks this process's event loop, and
      // the page the clip is opening is served by this process.
      const { status, stderr } = await runAsync(
        ["record", "--draft", "broken"],
        dir,
      );
      expect(status).toBe(1);
      expect(stderr).toContain("no-such-control");
      expect(stderr).toContain("the page when it gave up");
      expect(stderr).toContain("failure.png");
      expect(
        existsSync(
          join(dir, ".versioncam", "recordings", "broken", "failure.png"),
        ),
      ).toBe(true);
    } finally {
      await close();
    }
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
    // Eight tiles: the ends, the beat, and an even spread over the rest.
    //
    // The beat is sampled at 46 rather than at its mark on 40, because a mark
    // sits on the first frame of the renderer's crossfade, where the tile
    // still shows the page as it was before the wait. Six frames on, the
    // dissolve has finished. The example app's first authored clip found
    // this — its one beat came out as the old list with the new one ghosting
    // through it, and the reviewer said so and refused to judge from that tile.
    const sampled = frames.replace("frames ", "").split(" · ").map(Number);
    expect(sampled).toContain(46);
    expect(sampled).not.toContain(40);
    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBe(114);
    expect(sampled).toHaveLength(8);
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

  test("frame --at picks the frame by the beat it shows", () => {
    const dir = appDirWithRecording([{ frame: 40, label: "after click" }]);

    // The frame the sheet shows for that beat: past the six-frame crossfade
    // that starts on the mark, where the page is still the old one.
    const byBeat = run(["frame", "buttons", "--at", "after"], dir);
    expect(byBeat.status).toBe(0);
    expect(byBeat.stdout.trim().endsWith("buttons-frame-46.png")).toBe(true);

    const missing = run(["frame", "buttons", "--at", "filtered"], dir);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('No beat is labelled "filtered"');
    expect(missing.stderr).toContain('"after click"');
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

  /**
   * `--cwd`, as a monorepo meets it: run from somewhere that is not the app.
   * Each test runs the CLI from an empty directory beside the app, so nothing
   * it finds can have come from where it runs.
   */
  test("--cwd works in the directory it names, as if run there", () => {
    const dir = appDirWithRecording([
      { frame: 0, label: "open /buttons.html" },
      { frame: 79, label: "after click" },
    ]);
    writeFileSync(
      join(dir, "beats.json"),
      `${JSON.stringify([{ label: "after click", expect: "the counter reads 1" }])}\n`,
    );
    const elsewhere = mkdtempSync(join(tmpdir(), "versioncam-elsewhere-"));

    // Before the command's name, relative to where the command runs, with the
    // beat sheet's path relative to the directory it names and not to here.
    const review = run(
      [
        "--cwd",
        relative(elsewhere, dir),
        "review",
        "buttons",
        "--beats",
        "beats.json",
        "--min",
        "1",
        "--max",
        "3",
      ],
      elsewhere,
    );
    expect(review.stdout).toContain("buttons: PASS");
    expect(review.status).toBe(0);

    // After it: where the reviewer, allowed `npx versioncam frame *` and
    // nothing else, has to put it.
    const frame = run(["frame", "buttons", "10", `--cwd=${dir}`], elsewhere);
    expect(frame.status).toBe(0);
    const file = frame.stdout.trim();
    expect(file.endsWith("buttons-frame-10.png")).toBe(true);
    expect(realpathSync(file).startsWith(realpathSync(dir))).toBe(true);
  });

  test("--cwd reads the environment files of the directory it names", () => {
    // Loaded after the move, not before: a sign-in's variables sit beside the
    // config they are for.
    const dir = appDir();
    writeFileSync(
      join(dir, "versioncam.config.ts"),
      `import { defineRecorder } from "versioncam";\n` +
        `export default defineRecorder({ baseUrl: process.env.VERSIONCAM_TEST_URL ?? "http://example.test" });\n`,
    );
    writeFileSync(
      join(dir, ".env.recording"),
      "VERSIONCAM_TEST_URL=http://from-env-recording.test\n",
    );
    const elsewhere = mkdtempSync(join(tmpdir(), "versioncam-elsewhere-"));
    const { status, stdout } = run(["doctor", "--cwd", dir], elsewhere);
    expect(stdout).toContain("http://from-env-recording.test");
    // Nothing serves it; the point is only which address was asked.
    expect(status).toBe(1);
  });

  test("--cwd refuses a directory whose own versioncam is another one", () => {
    // What `npx` does from above an app that has versioncam in its own
    // node_modules: it runs another copy, or downloads the latest, and that
    // copy would record with a Chromium the app never pinned.
    const dir = mkdtempSync(join(tmpdir(), "versioncam-other-"));
    const other = join(dir, "node_modules", "versioncam");
    mkdirSync(other, { recursive: true });
    writeFileSync(
      join(other, "package.json"),
      '{ "name": "versioncam", "version": "0.0.1" }\n',
    );
    writeFileSync(
      join(dir, "versioncam.config.ts"),
      'export default { baseUrl: "http://example.test" };\n',
    );
    const elsewhere = mkdtempSync(join(tmpdir(), "versioncam-elsewhere-"));

    const { status, stdout, stderr } = run(["doctor", "--cwd", dir], elsewhere);
    expect(status).toBe(1);
    expect(stderr).toContain(
      `its own versioncam 0.0.1 in ${realpathSync(other)}`,
    );
    expect(stderr).toContain("never below");
    expect(stderr).toContain("then the same command without --cwd");
    // Refused before the command began.
    expect(stdout).toBe("");
  });

  test("--cwd says what is wrong with the directory it was given", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "versioncam-elsewhere-"));

    const missing = run(["doctor", "--cwd", "no-such-app"], elsewhere);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("there is no directory");
    expect(missing.stderr).toContain("no-such-app");

    const left = run(["doctor", "--cwd"], elsewhere);
    expect(left.status).toBe(1);
    expect(left.stderr).toContain("`--cwd` needs a directory");
  });

  test("dsl prints the reference, and every method in it is real", () => {
    const { status, stdout } = run(["dsl"], PACKAGE);
    expect(status).toBe(0);
    expect(stdout).toContain("byTestId");
    expect(stdout).toContain("camera.zoom");
    // `drag` is here now, and was not for months while the README claimed it.
    // The guarantee is not that any particular method exists — `dsl.spec.ts`
    // enforces that this list and the session agree — it is that reading this
    // output is never how you learn about a method that is not there.
    expect(stdout).toContain("drag(");
  });

  /**
   * `init` copies prompts into a repository, so the interesting behaviour is
   * what it does the second time: a plugin update must never silently discard
   * a file someone has edited.
   */
  test("init installs the skill and the reviewer, and will not clobber them", () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-init-"));
    const skill = join(dir, ".claude", "skills", "versioncam", "SKILL.md");
    const reviewer = join(dir, ".claude", "agents", "versioncam-reviewer.md");

    // It needs no config: the first run of the skill writes that.
    const first = run(["init"], dir);
    expect(first.status).toBe(0);
    for (const file of ["SKILL.md", "authoring.md", "onboarding.md"]) {
      expect(first.stdout).toContain(
        join(".claude", "skills", "versioncam", file),
      );
    }
    expect(first.stdout).toContain(
      join(".claude", "agents", "versioncam-reviewer.md"),
    );
    expect(readFileSync(reviewer, "utf8")).toContain(
      "name: versioncam-reviewer",
    );
    expect(first.stdout).toContain(
      'Installed. Ask your agent: /versioncam "<what the clip should show>"',
    );
    expect(first.stdout).toContain("The first run sets this repository up.");
    // No config stub: the first run writes the real one.
    expect(existsSync(join(dir, "versioncam.config.ts"))).toBe(false);

    writeFileSync(skill, "edited by hand");

    const second = run(["init"], dir);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain(join("versioncam", "SKILL.md"));
    expect(second.stderr).toContain("--force");
    expect(readFileSync(skill, "utf8")).toBe("edited by hand");

    const forced = run(["init", "--force"], dir);
    expect(forced.status).toBe(0);
    expect(readFileSync(skill, "utf8")).toContain("name: versioncam");
  });

  test("init refuses the lot when any one file is already there", () => {
    // Half an install is the bad outcome: a new skill beside an old reviewer
    // fails in the middle of a round instead of at the copy.
    const dir = mkdtempSync(join(tmpdir(), "versioncam-init-"));
    const reviewer = join(dir, ".claude", "agents", "versioncam-reviewer.md");
    mkdirSync(dirname(reviewer), { recursive: true });
    writeFileSync(reviewer, "someone else's reviewer");

    const { status, stderr } = run(["init"], dir);
    expect(status).toBe(1);
    expect(stderr).toContain("versioncam-reviewer.md");
    expect(stderr).toContain("Nothing was copied");
    expect(existsSync(join(dir, ".claude", "skills", "versioncam"))).toBe(
      false,
    );
  });

  test("init --into puts the skill, reviewer and all, where another host looks", () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-init-"));
    const { status, stdout } = run(["init", "--into", "agent-skills"], dir);
    expect(status).toBe(0);
    const target = join(dir, "agent-skills", "versioncam");
    for (const file of [
      "SKILL.md",
      "authoring.md",
      "onboarding.md",
      "versioncam-reviewer.md",
    ]) {
      expect(existsSync(join(target, file))).toBe(true);
    }
    // It says where the reviewer went, and touches nothing of Claude Code's.
    expect(stdout).toContain(
      join("agent-skills", "versioncam", "versioncam-reviewer.md"),
    );
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  test("init --claude is gone, and says what replaced it", () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-init-"));
    const { status, stderr } = run(["init", "--claude"], dir);
    expect(status).toBe(1);
    expect(stderr).toContain("`--claude` is gone");
    expect(stderr).toContain("--into");
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });
});
