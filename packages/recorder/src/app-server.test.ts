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
    const app = await ensureApp(configFor(port, { command: "exit 1" }));

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
    expect(app.detail).toMatch(/^started with ".*", HTTP 200 after \d+\.\d s$/);
    expect(await refuses(port)).toBe(false);
    // While it runs, Ctrl-C has somewhere to go.
    expect(process.listenerCount("SIGINT")).toBe(before + 1);

    await app.stop();
    expect(await refuses(port)).toBe(true);
    // And afterwards nothing of it is left listening, for signals or for HTTP.
    expect(process.listenerCount("SIGINT")).toBe(before);
    expect(process.listenerCount("exit")).toBe(exitBefore);
  }, 20_000);

  it("gives up after timeoutMs, with the output, and leaves nothing behind", async () => {
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

  it("does not wait out the timeout for a command that has already died", async () => {
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
  }, 20_000);
  it("does not hand the app what the recorder loaded for itself", async () => {
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
