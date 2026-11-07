import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { connect, createServer as createTcpServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureApp, withApp } from "./app-server.js";
import { resolveConfig } from "./config.js";
import type { WebServerConfig } from "./config.js";
import { loadEnvFiles } from "./env.js";

const WINDOWS = process.platform === "win32";

/**
 * Each test gets a port nothing is using, from the kernel, rather than a
 * number picked by hand that the next test run — or the example app — might
 * already be serving.
 */
async function freePort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

/** True once nothing accepts a connection on the port. */
function refuses(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

function configFor(port: number, webServer: WebServerConfig) {
  const root = mkdtempSync(join(tmpdir(), "versioncam-app-"));
  return resolveConfig(
    { baseUrl: `http://127.0.0.1:${port}`, webServer },
    root,
  );
}

/** A server the test itself runs: "somebody else's", as far as the code knows. */
const running: Server[] = [];
async function serve(port: number): Promise<void> {
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((ready) => server.listen(port, "127.0.0.1", ready));
  running.push(server);
}

afterEach(async () => {
  await Promise.all(
    running
      .splice(0)
      .map((s) => new Promise<void>((done) => s.close(() => done()))),
  );
});

/** A one-line HTTP server, run by the shell the way a dev server would be. */
function nodeServer(port: number, banner = ""): string {
  const script =
    `require('http').createServer((q, s) => s.end('ok'))` +
    `.listen(${port}, '127.0.0.1', () => console.log('${banner}'))`;
  return `"${process.execPath}" -e "${script}"`;
}

describe("ensureApp", () => {
  it("does nothing at all without a webServer", async () => {
    const root = mkdtempSync(join(tmpdir(), "versioncam-app-"));
    const app = await ensureApp(
      resolveConfig({ baseUrl: "http://127.0.0.1:9" }, root),
    );
    expect(app.started).toBe(false);
    await app.stop();
  });

  it("reuses a server that is already answering, and leaves it running", async () => {
    const port = await freePort();
    await serve(port);
    // Stated, not defaulted: the default is off wherever CI is set, and this
    // suite runs in CI too.
    const app = await ensureApp(
      configFor(port, { command: "exit 1", reuseExistingServer: true }),
    );

    expect(app.started).toBe(false);
    expect(app.detail).toContain(`http://127.0.0.1:${port}`);
    expect(app.detail).toContain("HTTP 200");
    await app.stop();
    expect(await refuses(port)).toBe(false);
  });

  it("refuses to reuse one when told not to, and names the port", async () => {
    const port = await freePort();
    await serve(port);
    const config = configFor(port, {
      command: "exit 1",
      reuseExistingServer: false,
    });
    await expect(ensureApp(config)).rejects.toThrow(`port ${port}`);
  });

  it("starts the command when nothing answers, and stops all of it", async () => {
    const port = await freePort();
    const before = process.listenerCount("SIGINT");
    const exitBefore = process.listenerCount("exit");
    const app = await ensureApp(configFor(port, { command: nodeServer(port) }));

    expect(app.started).toBe(true);
    expect(app.detail).toMatch(
      /^started with ".*", answered HTTP 200 after \d+\.\d s$/,
    );
    expect(await refuses(port)).toBe(false);
    // While it runs, Ctrl-C has somewhere to go.
    expect(process.listenerCount("SIGINT")).toBe(before + 1);

    await app.stop();
    expect(await refuses(port)).toBe(true);
    // And afterwards nothing of it is left listening, for signals or for HTTP.
    expect(process.listenerCount("SIGINT")).toBe(before);
    expect(process.listenerCount("exit")).toBe(exitBefore);
  }, 20_000);

  it("stops a server two processes under the command", async () => {
    // The shape of `npm run dev`, on Windows above all: a shell, a node that
    // starts another node, and only that one holds the port. A stop that reached
    // the top of it alone would leave the port taken for the next command.
    const port = await freePort();
    // The command needs the config's directory, so it is filled in second.
    const config = configFor(port, { command: "exit 1" });
    const launcher = join(config.root, "launcher.cjs");
    writeFileSync(
      launcher,
      [
        "const { spawn } = require('node:child_process');",
        `const server = "require('node:http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1')";`,
        "const child = spawn(process.execPath, ['-e', server], { stdio: 'ignore' });",
        "console.log('server ' + child.pid);",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    config.webServer = {
      ...config.webServer!,
      command: `"${process.execPath}" "${launcher}"`,
    };

    const app = await ensureApp(config);
    expect(app.started).toBe(true);
    await app.stop();

    const log = readFileSync(join(config.outDir, "webserver.log"), "utf8");
    const pid = Number(/server (\d+)/.exec(log)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(await refuses(port)).toBe(true);
    // Its parent is gone, so nothing here reaps it, and until something does a
    // zombie can still answer: asked for a moment, not once.
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 2_000 },
      )
      .toBe(false);
  }, 20_000);

  it("takes the carriage returns off what a dead command printed", async () => {
    // What Windows programs print. This is also the case of a command that dies
    // at once, for Windows, where the test of it below is skipped: `exitCode`
    // rather than `process.exit`, because stderr to a pipe is asynchronous there.
    const port = await freePort();
    const script = `process.stderr.write('boom\\r\\n');process.exitCode=3`;
    const error = (await ensureApp(
      configFor(port, {
        command: `"${process.execPath}" -e "${script}"`,
        timeoutMs: 60_000,
      }),
    ).then(
      () => null,
      (e: Error) => e,
    )) as Error;
    expect(error?.message).toMatch(/exited with code 3[\s\S]*boom/);
    expect(error.message).not.toContain("\r");
  }, 20_000);

  it("gives up after timeoutMs, with the output, and leaves nothing behind", async ({
    skip,
  }) => {
    skip(WINDOWS, "a POSIX shell line: $$ and exec mean nothing to cmd.exe");
    const port = await freePort();
    // `exec` makes the sleep the very process the shell was, so the pid it
    // prints is the one that has to be gone afterwards.
    const config = configFor(port, {
      command: 'echo "pid $$"; exec sleep 30',
      timeoutMs: 1_500,
    });

    const started = Date.now();
    const error = (await ensureApp(config).then(
      () => null,
      (e: Error) => e,
    )) as Error;
    expect(error?.message).toMatch(/timed out/);
    expect(error.message).toMatch(/within 1\.5 s/);
    expect(Date.now() - started).toBeLessThan(10_000);

    const pid = Number(/pid (\d+)/.exec(error.message)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 20_000);

  it("does not call a 5xx ready, and waits for the server to finish starting", async () => {
    // Nuxt's dev server, in small: 503 while it compiles, then the app.
    const port = await freePort();
    const config = configFor(port, {
      command:
        `node -e "const up=Date.now()+1200;` +
        `require('http').createServer((q,r)=>{r.statusCode=Date.now()<up?503:200;r.end('ok')})` +
        `.listen(${port},'127.0.0.1')"`,
      timeoutMs: 20_000,
    });
    const app = await ensureApp(config);
    try {
      expect(app.detail).toMatch(/HTTP 200/);
    } finally {
      await app.stop();
    }
  }, 30_000);

  it("gives up on a command that only ever answers 5xx, and says so", async () => {
    const port = await freePort();
    const config = configFor(port, {
      command:
        `node -e "require('http').createServer((q,r)=>{r.statusCode=500;r.end('no')})` +
        `.listen(${port},'127.0.0.1')"`,
      timeoutMs: 1_500,
    });
    await expect(ensureApp(config)).rejects.toThrow(
      /answered only HTTP 500[\s\S]*within 1\.5 s/,
    );
    expect(await refuses(port)).toBe(true);
  }, 20_000);

  it("waits for someone else's server that is still starting", async () => {
    const port = await freePort();
    const up = Date.now() + 1_000;
    const server = createServer((_request, response) => {
      response.statusCode = Date.now() < up ? 503 : 200;
      response.end("ok");
    });
    await new Promise<void>((ready) => server.listen(port, "127.0.0.1", ready));
    running.push(server);
    const app = await ensureApp(
      configFor(port, { command: "exit 9", reuseExistingServer: true }),
    );
    expect(app.started).toBe(false);
    expect(app.detail).toMatch(/HTTP 200/);
    await app.stop();
  }, 20_000);

  it("does not wait out a server of someone else's that is failing for good", async () => {
    const port = await freePort();
    const server = createServer((_request, response) => {
      response.statusCode = 500;
      response.end("no");
    });
    await new Promise<void>((ready) => server.listen(port, "127.0.0.1", ready));
    running.push(server);
    await expect(
      ensureApp(
        configFor(port, {
          command: "exit 9",
          reuseExistingServer: true,
          timeoutMs: 1_000,
        }),
      ),
    ).rejects.toThrow(/answered HTTP 500 for 1\.0 s/);
  }, 20_000);

  it("does not wait out the timeout for a command that has already died", async ({
    skip,
  }) => {
    skip(
      WINDOWS,
      "a POSIX shell line: ; does not separate commands in cmd.exe",
    );
    // A strict port that is taken, a typo in a script name: the command exits
    // at once, and two minutes of polling would help nobody.
    const port = await freePort();
    const started = Date.now();
    await expect(
      ensureApp(
        configFor(port, {
          command: "echo boom >&2; exit 3",
          timeoutMs: 60_000,
        }),
      ),
    ).rejects.toThrow(/exited with code 3[\s\S]*boom/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("appends what the server prints to <outDir>/webserver.log", async () => {
    const port = await freePort();
    const config = configFor(port, {
      command: nodeServer(port, "hello from the dev server"),
    });
    const app = await ensureApp(config);
    await app.stop();

    const log = readFileSync(join(config.outDir, "webserver.log"), "utf8");
    expect(log).toContain("hello from the dev server");
    expect(log).toContain(nodeServer(port, "hello from the dev server"));
    // And how it ended: whether it needed a SIGKILL is the first question
    // when a database it held comes back in a bad state.
    expect(log).toMatch(
      WINDOWS ? /stopped: taskkill/ : /stopped: SIGTERM, all of it gone after/,
    );
  }, 20_000);

  it("says so when the app outlives its process group", async ({ skip }) => {
    skip(WINDOWS, "a tree kill reaches a detached grandchild, so none escapes");
    // The case that no signal to the group can fix: the start command hands
    // the server to something outside it — here a detached grandchild, in
    // life a container runtime — and exits. The port is what tells.
    const port = await freePort();
    // The command needs the config's directory, so it is filled in second.
    const config = configFor(port, { command: "true" });
    const launcher = join(config.root, "launcher.cjs");
    writeFileSync(
      launcher,
      [
        "const { spawn } = require('node:child_process');",
        `const server = "require('node:http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1')";`,
        "const child = spawn(process.execPath, ['-e', server], { detached: true, stdio: 'ignore' });",
        "console.log('escaped ' + child.pid);",
        "child.unref();",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    config.webServer = {
      ...config.webServer!,
      command: `"${process.execPath}" "${launcher}"`,
    };

    const warnings: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let escaped = 0;
    try {
      const app = await ensureApp(config);
      expect(app.started).toBe(true);
      await app.stop();
      const log = readFileSync(join(config.outDir, "webserver.log"), "utf8");
      escaped = Number(/escaped (\d+)/.exec(log)?.[1]);
      expect(warnings.join("")).toContain("still answers");
      expect(log).toContain("still answers");
      expect(await refuses(port)).toBe(false);
    } finally {
      process.stderr.write = write;
      if (escaped > 0) process.kill(escaped, "SIGTERM");
    }
  }, 20_000);
  it("does not hand the app what the recorder loaded for itself", async ({
    skip,
  }) => {
    skip(WINDOWS, "a POSIX shell line: $NAME and ; mean nothing to cmd.exe");
    // `.env.recording` holds the recorder's sign-in. The dev server gets the
    // shell's environment — and Vite would let a variable it inherited
    // override the app's own `.env`, so this is about behaviour, not tidiness.
    const port = await freePort();
    const config = configFor(port, {
      command: `echo "token=[$VERSIONCAM_TEST_TOKEN]"; ${nodeServer(port)}`,
    });
    writeFileSync(
      join(config.root, ".env.recording"),
      "VERSIONCAM_TEST_TOKEN=for-the-recorder-only\n",
    );
    loadEnvFiles(config.root);
    try {
      expect(process.env.VERSIONCAM_TEST_TOKEN).toBe("for-the-recorder-only");
      const app = await ensureApp(config);
      await app.stop();
      const log = readFileSync(join(config.outDir, "webserver.log"), "utf8");
      expect(log).toContain("token=[]");
    } finally {
      delete process.env.VERSIONCAM_TEST_TOKEN;
    }
  }, 20_000);
});

describe("withApp", () => {
  it("stops what it started when the work throws", async () => {
    // The case that matters: a clip that fails must not leave a dev server
    // holding the port for the next run to trip over.
    const port = await freePort();
    const config = configFor(port, { command: nodeServer(port) });
    await expect(
      withApp(config, async (app) => {
        expect(app.started).toBe(true);
        throw new Error("the clip broke");
      }),
    ).rejects.toThrow("the clip broke");
    expect(await refuses(port)).toBe(true);
  }, 20_000);
});
