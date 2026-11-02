import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import {
  ReplayBook,
  describeReplay,
  effectiveMode,
  entryOf,
  globToRegExp,
  pacedReplayScript,
  urlKey,
} from "./replay.js";
import type { Har, HarEntry } from "./replay.js";

const RECORDED = "2026-11-02T10:00:00.000Z";

function exchange(overrides: Partial<Parameters<typeof entryOf>[0]> = {}) {
  return {
    method: "GET",
    url: "https://api.example.test/v1/answer?q=1",
    requestHeaders: {},
    postData: null,
    status: 200,
    statusText: "OK",
    responseHeaders: { "content-type": "application/json" },
    body: new TextEncoder().encode('{"n":1}'),
    ...overrides,
  };
}

function entry(
  url: string,
  text: string,
  options: { method?: string; postData?: string } = {},
): HarEntry {
  return entryOf(
    exchange({
      url,
      method: options.method ?? "GET",
      postData: options.postData ?? null,
      body: new TextEncoder().encode(text),
    }),
    { redact: [], recorded: RECORDED, store: () => undefined },
  );
}

describe("a replay's URL patterns", () => {
  it("read a glob as Playwright does", () => {
    const tiles = globToRegExp("https://tiles.example.test/**");
    expect(tiles.test("https://tiles.example.test/4/8/5.png")).toBe(true);
    expect(tiles.test("https://other.example.test/4/8/5.png")).toBe(false);
    const oneLevel = globToRegExp("**/api/*");
    expect(oneLevel.test("http://x.test/api/chat")).toBe(true);
    expect(oneLevel.test("http://x.test/api/chat/stream")).toBe(false);
    const either = globToRegExp("**/{jobs,status}/*");
    expect(either.test("http://x.test/jobs/1")).toBe(true);
    expect(either.test("http://x.test/status/1")).toBe(true);
    // A question mark is itself, as in Playwright's globs.
    expect(globToRegExp("**/a?b").test("http://x.test/a?b")).toBe(true);
    expect(globToRegExp("**/a?b").test("http://x.test/axb")).toBe(false);
  });
});

describe("a recorded exchange", () => {
  it("leaves out the secrets and the redacted parameters", () => {
    const recorded = entryOf(
      exchange({
        url: "https://api.example.test/v1/answer?q=1&token=abc&user_id=7",
        requestHeaders: {
          Authorization: "Bearer secret",
          Cookie: "session=1",
          "X-API-Key": "key",
          Accept: "application/json",
        },
        responseHeaders: {
          "content-type": "application/json",
          "Set-Cookie": "session=2",
          "x-request-id": "r1",
        },
      }),
      { redact: ["token"], recorded: RECORDED, store: () => undefined },
    );
    const text = JSON.stringify(recorded);
    for (const secret of [
      "Bearer secret",
      "session=1",
      "session=2",
      'key"',
      "abc",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(recorded.request.url).toBe(
      "https://api.example.test/v1/answer?q=1&user_id=7",
    );
    expect(recorded.request.headers).toEqual([
      { name: "Accept", value: "application/json" },
    ]);
    expect(recorded.response.headers.map((h) => h.name)).toEqual([
      "content-type",
      "x-request-id",
    ]);
  });

  it("keeps a text body readable and hands a binary one to the store", () => {
    const stored = new Map<string, Uint8Array>();
    const store = (hash: string, bytes: Uint8Array) => stored.set(hash, bytes);
    const json = entryOf(exchange(), { redact: [], recorded: RECORDED, store });
    expect(json.response.content.text).toBe('{"n":1}');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const tile = entryOf(
      exchange({ responseHeaders: { "content-type": "image/png" }, body: png }),
      { redact: [], recorded: RECORDED, store },
    );
    expect(tile.response.content.text).toBeUndefined();
    const hash = tile.response.content._file ?? "";
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.get(hash)).toEqual(png);
  });
});

describe("serving from a replay", () => {
  it("answers a URL's requests in the order they were recorded, then the last again", () => {
    const status = "https://api.example.test/jobs/7";
    const book = new ReplayBook(
      [
        entry(status, '{"status":"pending"}'),
        entry(status, '{"status":"running"}'),
        entry(status, '{"status":"done"}'),
      ],
      [],
    );
    const answers = [1, 2, 3, 4, 5].map(
      () => book.answer("GET", status, null)?.response.content.text,
    );
    expect(answers).toEqual([
      '{"status":"pending"}',
      '{"status":"running"}',
      '{"status":"done"}',
      '{"status":"done"}',
      '{"status":"done"}',
    ]);
  });

  it("takes an answer recorded for the same request body first", () => {
    const query = "https://api.example.test/query";
    const book = new ReplayBook(
      [
        entry(query, "a", { method: "POST", postData: '{"q":"a"}' }),
        entry(query, "b", { method: "POST", postData: '{"q":"b"}' }),
      ],
      [],
    );
    expect(book.answer("POST", query, '{"q":"b"}')?.response.content.text).toBe(
      "b",
    );
    expect(book.answer("POST", query, '{"q":"a"}')?.response.content.text).toBe(
      "a",
    );
  });

  it("matches without the redacted parameters, and holds nothing for another URL", () => {
    const book = new ReplayBook(
      [entry("https://api.example.test/v1/answer?q=1", "one")],
      ["token"],
    );
    expect(
      book.answer(
        "GET",
        "https://api.example.test/v1/answer?q=1&token=new",
        null,
      )?.response.content.text,
    ).toBe("one");
    expect(
      book.answer("GET", "https://api.example.test/v1/answer?q=2", null),
    ).toBeNull();
    expect(
      book.answer("POST", "https://api.example.test/v1/answer?q=1", null),
    ).toBeNull();
    expect(urlKey("https://x.test/a?b=1#frag", [])).toBe(
      "https://x.test/a?b=1",
    );
  });
});

describe("a clip's replay mode", () => {
  it("records once, then replays, unless told", () => {
    expect(effectiveMode("auto", false)).toBe("record");
    expect(effectiveMode("auto", true)).toBe("replay");
    expect(effectiveMode("record", true)).toBe("record");
    expect(effectiveMode("live", true)).toBe("live");
  });

  it("knows a replay's age and size from the file, not its timestamp on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-replay-"));
    const har: Har = {
      log: {
        version: "1.2",
        creator: { name: "versioncam", version: "0.7.0" },
        comment: "",
        _versioncam: {
          clip: "c",
          recorded: "2026-07-01T00:00:00.000Z",
          recorder: "0.7.0",
        },
        entries: [
          entry("https://x.test/a", "1"),
          entry("https://x.test/b", "2"),
        ],
      },
    };
    writeFileSync(join(dir, "c.har"), JSON.stringify(har));
    const found = describeReplay(
      dir,
      "c",
      new Date("2026-11-02T00:00:00.000Z"),
    );
    expect(found).toMatchObject({ exists: true, requests: 2, ageDays: 124 });
    expect(describeReplay(dir, "missing").exists).toBe(false);
  });
});

describe("the pacing script", () => {
  it("is a script the page can run", () => {
    const script = pacedReplayScript([{ url: /\/stream$/, chunkMs: 200 }]);
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("__recorderReplay");
  });
});

describe("the replay config", () => {
  const ROOT = "/tmp/app";
  it("is absent unless asked for, and resolves beside the config", () => {
    expect(resolveConfig({ baseUrl: "http://x" }, ROOT).replay).toBeNull();
    const replay = resolveConfig(
      {
        baseUrl: "http://x",
        replay: {
          record: ["https://tiles.example.test/**", /\/api\/chat\//],
          pace: [{ url: "**/stream/*", chunkMs: 250 }],
        },
      },
      ROOT,
    ).replay;
    expect(replay?.dir).toBe("/tmp/app/replay");
    expect(replay?.mode).toBe("auto");
    expect(replay?.onMissing).toBe("fail");
    expect(replay?.record).toHaveLength(2);
    expect(replay?.pace[0].chunkMs).toBe(250);
  });

  it("refuses what would match nothing or pace nothing, by name", () => {
    const bad = (replay: unknown) => () =>
      resolveConfig({ baseUrl: "http://x", replay: replay as never }, ROOT);
    expect(bad({ record: [] })).toThrow(
      /`replay.record` must name at least one URL/,
    );
    expect(bad({ record: [42] })).toThrow(
      /`replay.record\[0\]` must be a URL glob/,
    );
    expect(bad({ record: ["**/a"], mode: "replayed" })).toThrow(
      /`replay.mode`/,
    );
    expect(
      bad({ record: ["**/a"], pace: [{ url: "**/a", chunkMs: 0 }] }),
    ).toThrow(/`replay.pace\[0\].chunkMs` must be milliseconds/);
    expect(bad({ record: ["**/a"], onMissing: "skip" })).toThrow(
      /`replay.onMissing`/,
    );
  });
});
