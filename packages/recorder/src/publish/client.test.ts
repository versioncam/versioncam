import { describe, expect, it } from "vitest";
import {
  publishRecordings,
  PublishRefused,
  type PublishFiles,
} from "./client.js";
import {
  PUBLISH_PROTOCOL,
  type PublishBegin,
  type PublishBeginResponse,
} from "./protocol.js";

const begin: PublishBegin = {
  protocol: PUBLISH_PROTOCOL,
  recorder: "0.3.0",
  project: "acme/app",
  commit: "a".repeat(40),
  branch: "main",
  ref: "refs/heads/main",
  runId: "7",
  clips: [
    {
      id: "one",
      title: "One",
      check: { status: "pass" },
      failureHash: null,
      recording: {
        contentHash: "c1",
        timelineHash: "t1",
        timelineBytes: 10,
        targetsHash: "g1",
        draft: false,
        fps: 60,
        durationFrames: 3,
        viewport: { width: 10, height: 10, dpr: 1 },
        states: [
          { hash: "s1", bytes: 1, width: 10, height: 10 },
          { hash: "s2", bytes: 1, width: 10, height: 10 },
        ],
        renderConfig: {} as never,
      },
    },
  ],
};

const files: PublishFiles = {
  state: async (hash) => new TextEncoder().encode(`state ${hash}`),
  timeline: async (clip) => new TextEncoder().encode(`timeline ${clip}`),
  targets: async (clip) => new TextEncoder().encode(`targets ${clip}`),
  failure: async (clip) => new TextEncoder().encode(`failure ${clip}`),
};

type Seen = { method: string; path: string; auth: string | null };

/** A fake service: answers begin with `need`, records every request. */
function service(
  need: Partial<PublishBeginResponse>,
  quirks: { failFirst?: (path: string) => number | null } = {},
) {
  const seen: Seen[] = [];
  const failed = new Set<string>();
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    seen.push({
      method,
      path,
      auth: new Headers(init?.headers).get("authorization"),
    });
    const status = quirks.failFirst?.(path);
    if (status && !failed.has(path)) {
      failed.add(path);
      return new Response("busy", { status });
    }
    if (path === "/v1/publish/begin") {
      return Response.json({
        publishId: "pub1",
        project: "acme/app",
        needStates: [],
        needTimelines: [],
        needTargets: [],
        needFailures: [],
        refused: [],
        ...need,
      });
    }
    if (path.endsWith("/commit")) {
      return Response.json({
        project: "acme/app",
        versions: [
          {
            clip: "one",
            version: "ver1",
            url: "https://clips.version.cam/acme/app/one@main",
            versionUrl: "https://clips.version.cam/acme/app/one@ver1",
            check: "pass",
            unchanged: false,
            stale: false,
            refused: null,
          },
        ],
      });
    }
    return new Response(null, { status: 204 });
  };
  return { fetch: fetch as typeof globalThis.fetch, seen };
}

describe("publishing", () => {
  it("uploads only what the service asks for, then commits", async () => {
    const { fetch, seen } = service({
      needStates: ["s2"],
      needTimelines: ["one"],
      needTargets: ["one"],
    });
    const { committed } = await publishRecordings(begin, files, {
      api: "https://api.example/",
      credential: "vc_secret",
      fetch,
      backoffMs: [],
    });

    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "POST /v1/publish/begin",
      "PUT /v1/publish/pub1/state/s2",
      "PUT /v1/publish/pub1/timeline/one",
      "PUT /v1/publish/pub1/targets/one",
      "POST /v1/publish/pub1/commit",
    ]);
    expect(seen.every((s) => s.auth === "Bearer vc_secret")).toBe(true);
    expect(committed.versions[0].url).toBe(
      "https://clips.version.cam/acme/app/one@main",
    );
  });

  it("uploads nothing for a version the service already has", async () => {
    const { fetch, seen } = service({});
    await publishRecordings(begin, files, {
      api: "https://api.example",
      credential: "t",
      fetch,
      backoffMs: [],
    });
    expect(seen.map((s) => s.method)).toEqual(["POST", "POST"]);
  });

  it("retries what a retry can fix", async () => {
    const { fetch, seen } = service(
      { needStates: ["s1"] },
      { failFirst: (path) => (path.includes("/state/") ? 503 : null) },
    );
    await publishRecordings(begin, files, {
      api: "https://api.example",
      credential: "t",
      fetch,
      backoffMs: [1, 1],
    });
    expect(seen.filter((s) => s.path.includes("/state/"))).toHaveLength(2);
  });

  it("passes on the service's own sentence when it refuses", async () => {
    const fetch = (async () =>
      Response.json(
        {
          error: "This repository is not installed; install the App first.",
          code: "not_installed",
        },
        { status: 403 },
      )) as typeof globalThis.fetch;
    const attempt = publishRecordings(begin, files, {
      api: "https://api.example",
      credential: "t",
      fetch,
      backoffMs: [1, 1],
    });
    await expect(attempt).rejects.toBeInstanceOf(PublishRefused);
    await expect(attempt).rejects.toThrow(
      "This repository is not installed; install the App first.",
    );
  });

  it("gives up after its tries when the service is down", async () => {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    await expect(
      publishRecordings(begin, files, {
        api: "https://api.example",
        credential: "t",
        fetch,
        backoffMs: [1, 1],
      }),
    ).rejects.toThrow("did not answer after 3 tries");
    expect(calls).toBe(3);
  });
});
