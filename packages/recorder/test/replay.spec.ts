import { expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import type { RecorderConfig } from "../src/config.js";
import { compareRecordings } from "../src/driver/compare.js";
import { clip, runClip } from "../src/driver/clip.js";
import type { ClipBody } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import type { Har, ReplayMode } from "../src/driver/replay.js";
import type { RecordingSession } from "../src/driver/session.js";
import { FIXTURES, testConfig } from "./support.js";

/**
 * Replay: a clip's responses recorded once and served on every run after.
 *
 * The server here is real and changes its answer on every request: a
 * counter that counts, and an event stream of four events. A test passes
 * only if what the page shows came from the file, not from the server.
 */

const STREAM = ["one", "two", "three", "four"];

let server: Server;
let api = "";
const served = { counter: 0, other: 0, stream: 0 };

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    const cors = { "access-control-allow-origin": "*" };
    if (path === "/counter" || path === "/other") {
      const key = path.slice(1) as "counter" | "other";
      served[key] += 1;
      response.writeHead(200, { ...cors, "content-type": "application/json" });
      response.end(JSON.stringify({ n: served[key] }));
    } else if (path === "/live.html") {
      // The page comes from the same server as its data, as an app's does.
      // From any other origin Chromium would refuse the page's own requests
      // to a loopback address, and only the replayed ones, which never reach
      // the network, would get through.
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(readFileSync(join(FIXTURES, "live.html")));
    } else if (path === "/stream") {
      served.stream += 1;
      response.writeHead(200, { ...cors, "content-type": "text/event-stream" });
      response.end(STREAM.map((word) => `data: ${word}\n\n`).join(""));
    } else {
      response.writeHead(404, cors).end();
    }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server.close();
});

function replayConfig(dir: string, extra: Partial<RecorderConfig> = {}) {
  return {
    replay: {
      record: [`${api}/counter*`, `${api}/stream`],
      dir,
      pace: [{ url: `${api}/stream`, chunkMs: 200 }],
    },
    ...extra,
  } satisfies Partial<RecorderConfig>;
}

/** Record `body` on the live fixture, as clip `id`. */
function record(
  browser: Browser,
  id: string,
  config: Partial<RecorderConfig>,
  body: ClipBody,
  options: { replay?: ReplayMode; query?: string } = {},
) {
  return runClip(
    browser,
    testConfig(config),
    clip(id, { title: "Live" }, async (s) => {
      await s.open(
        `${api}/live.html?api=${encodeURIComponent(api)}${options.query ?? ""}`,
      );
      await body(s);
    }),
    { replay: options.replay },
  );
}

const textOf = (s: RecordingSession, id: string): Promise<string> =>
  s.offCamera((page) => page.getByTestId(id).innerText());

const linesOf = (s: RecordingSession): Promise<number> =>
  s.offCamera((page) =>
    page.getByTestId("log").evaluate((log) => log.children.length),
  );

/**
 * Click `button` and hold a frame at a time, noting the clip's time at which
 * each line of the log first shows.
 */
async function streamed(s: RecordingSession, button: string, fps: number) {
  await s.click(s.byTestId(button));
  const at: number[] = [];
  for (
    let frame = 0;
    frame < fps * 2 && at.length < STREAM.length;
    frame += 1
  ) {
    await s.hold(1000 / fps);
    const lines = await linesOf(s);
    while (at.length < lines) at.push(s.at.t);
  }
  return at;
}

test.describe("replay", () => {
  let browser: Browser;
  test.beforeAll(async () => {
    browser = await launchBrowser();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  test("records a clip's responses once, and serves them on every run after", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-replay-"));
    const config = replayConfig(dir);
    let recordedCount = "";
    await record(browser, "live", config, async (s) => {
      await s.hold(200);
      recordedCount = await textOf(s, "count");
    });

    const file = join(dir, "live.har");
    expect(existsSync(file)).toBe(true);
    const har = JSON.parse(readFileSync(file, "utf8")) as Har;
    const counter = har.log.entries.find((e) =>
      e.request.url.endsWith("/counter"),
    );
    const n = JSON.parse(counter?.response.content.text ?? "{}").n as number;
    expect(recordedCount).toBe(`count ${n}`);
    expect(har.log._versioncam.clip).toBe("live");

    // Twice more, each from the file: the server's counter is not asked.
    const before = served.counter;
    const shown: string[] = [];
    const body: ClipBody = async (s) => {
      await s.hold(200);
      shown.push(await textOf(s, "count"));
    };
    const first = await record(browser, "live", config, body);
    const second = await record(browser, "live", config, body);
    expect(served.counter).toBe(before);
    expect(shown).toEqual([`count ${n}`, `count ${n}`]);
    expect(compareRecordings(first, second).firstDifference).toBeNull();
  });

  test("leaves a request it does not cover to the network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-replay-"));
    const config = replayConfig(dir);
    const others: string[] = [];
    const body: ClipBody = async (s) => {
      await s.hold(200);
      others.push(await textOf(s, "other"));
    };
    await record(browser, "uncovered", config, body, { query: "&other" });
    await record(browser, "uncovered", config, body, { query: "&other" });
    expect(others[0]).not.toBe(others[1]);
  });

  test("fails a clip that asks for a response its replay does not hold, naming it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-replay-"));
    const config = replayConfig(dir);
    await record(browser, "changed", config, async (s) => {
      await s.hold(200);
    });
    const failure = await record(browser, "changed", config, async (s) => {
      await s.click(s.byTestId("missing"));
      await s.hold(300);
    }).then(
      () => null,
      (error: Error) => error.message,
    );
    expect(failure).toContain(`GET ${api}/counter?page=2`);
    expect(failure).toContain("--replay record");
  });

  test("refuses to replay a file that is not there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-replay-"));
    await expect(
      record(browser, "never", replayConfig(dir), async () => undefined, {
        replay: "replay",
      }),
    ).rejects.toThrow(/there is no such file/);
  });

  test("delivers a paced stream a piece at a time, on the same frame every run, at any frame rate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-replay-"));
    const times: Record<string, number[]> = {};
    for (const [run, fps] of [
      ["record", 60],
      ["again", 60],
      ["slower", 30],
    ] as const) {
      await record(browser, "paced", replayConfig(dir, { fps }), async (s) => {
        times[run] = await streamed(s, "stream", fps);
      });
    }
    // Every piece arrived, one at a time.
    expect(times.record).toHaveLength(STREAM.length);
    // The record run and a replay of it land each piece on the same frame.
    expect(times.again).toEqual(times.record);
    // 200 ms of the page's clock between pieces, whatever the frame rate:
    // the third piece is 400 ms after the first, to the frame.
    for (const run of ["record", "slower"]) {
      const gap = times[run][2] - times[run][0];
      expect(Math.abs(gap - 0.4), run).toBeLessThanOrEqual(1 / 30 + 1e-9);
    }
  });

  test("paces an EventSource the same way", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-replay-"));
    const runs: number[][] = [];
    for (let run = 0; run < 2; run += 1) {
      await record(browser, "events", replayConfig(dir), async (s) => {
        runs.push(await streamed(s, "events", 60));
      });
    }
    expect(runs[0]).toHaveLength(STREAM.length);
    expect(runs[1]).toEqual(runs[0]);
    expect(Math.abs(runs[0][2] - runs[0][0] - 0.4)).toBeLessThanOrEqual(
      1 / 60 + 1e-9,
    );
  });
});
