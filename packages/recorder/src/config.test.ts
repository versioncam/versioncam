import { afterEach, describe, expect, it, vi } from "vitest";
import { outputSize, resolveConfig } from "./config.js";

const ROOT = "/tmp/app";

describe("resolveConfig", () => {
  it("fills the defaults an app should not have to state", () => {
    const c = resolveConfig({ baseUrl: "http://localhost:3000/" }, ROOT);

    expect(c.baseUrl).toBe("http://localhost:3000");
    expect(c.viewport).toEqual({ width: 1440, height: 900 });
    expect(c.dpr).toBe(2);
    expect(c.fps).toBe(60);
    expect(c.clips).toEqual(["demos/**/*.clip.ts"]);
    expect(c.settle.quietMs).toBe(150);
    expect(c.settle.ready).toBeNull();
    expect(c.auth).toBeNull();
    expect(c.scenes).toBeNull();
    // Presentation is off: the product records the product.
    expect(c.theme.presentation).toBeNull();
  });

  it("puts everything it writes under one ignorable directory", () => {
    const c = resolveConfig({ baseUrl: "http://x" }, ROOT);
    expect(c.outDir).toBe("/tmp/app/.versioncam");
    expect(c.recordingsDir).toBe("/tmp/app/.versioncam/recordings");
    expect(c.outputDir).toBe("/tmp/app/.versioncam/out");
    expect(c.cacheDir).toBe("/tmp/app/.versioncam/.cache");
  });

  it("resolves relative paths against the config's own directory", () => {
    const c = resolveConfig(
      { baseUrl: "http://x", scenes: "demos/scenes/index.ts" },
      ROOT,
    );
    expect(c.scenes).toBe("/tmp/app/demos/scenes/index.ts");
  });

  it("keeps absolute paths absolute", () => {
    const c = resolveConfig(
      { baseUrl: "http://x", outDir: "/var/tmp/d" },
      ROOT,
    );
    expect(c.outDir).toBe("/var/tmp/d");
  });

  it("names the field it rejected", () => {
    expect(() => resolveConfig({ baseUrl: "" }, ROOT)).toThrow(/`baseUrl`/);
    expect(() => resolveConfig({ baseUrl: "http://x", dpr: 4 }, ROOT)).toThrow(
      /`dpr`/,
    );
    expect(() => resolveConfig({ baseUrl: "http://x", fps: 5 }, ROOT)).toThrow(
      /`fps`/,
    );
    expect(() =>
      resolveConfig(
        { baseUrl: "http://x", viewport: { width: 0, height: 900 } },
        ROOT,
      ),
    ).toThrow(/`viewport.width`/);
    expect(() =>
      resolveConfig(
        {
          baseUrl: "http://x",
          theme: { presentation: { padding: 0.9 } },
        },
        ROOT,
      ),
    ).toThrow(/`theme.presentation.padding`/);
  });

  it("rejects an auth block that is both shapes or neither", () => {
    expect(() =>
      resolveConfig(
        {
          baseUrl: "http://x",
          auth: {
            storageState: "a.json",
            login: async () => {},
          } as never,
        },
        ROOT,
      ),
    ).toThrow(/`auth`/);
    expect(() =>
      resolveConfig({ baseUrl: "http://x", auth: {} as never }, ROOT),
    ).toThrow(/`auth`/);
  });

  it("merges motion overrides over the defaults", () => {
    const c = resolveConfig(
      { baseUrl: "http://x", motion: { zoomDurationMs: 2000 } },
      ROOT,
    );
    expect(c.motion.zoomDurationMs).toBe(2000);
    expect(c.motion.crossfadeFrames).toBe(6);
  });
});

describe("where a caption over the app sits", () => {
  const withInset = (captionInset: unknown, width = 1920) =>
    resolveConfig(
      {
        baseUrl: "http://x",
        output: { width },
        theme: { presentation: { captionInset } as never },
      },
      ROOT,
    );

  it("takes one side and a distance from it", () => {
    expect(withInset({ right: 360 }).theme.presentation?.captionInset).toEqual({
      right: 360,
    });
    expect(withInset({ left: 0 }).theme.presentation?.captionInset).toEqual({
      left: 0,
    });
  });

  it("refuses both sides, neither, or a distance off the video", () => {
    // Each of these would draw no caption, or one in a place nobody chose,
    // and say nothing about it.
    for (const inset of [{ left: 40, right: 40 }, {}, null]) {
      expect(() => withInset(inset)).toThrow(
        "`theme.presentation.captionInset` must be `{ left: n }` or `{ right: n }`, one side only",
      );
    }
    expect(() => withInset({ right: -1 })).toThrow(
      "`theme.presentation.captionInset.right` must be pixels of the video",
    );
    expect(() => withInset({ left: "40" })).toThrow(
      /`theme.presentation.captionInset.left`.*got "40"$/,
    );
    // The video's width, not the viewport's: 1280 at `output.width: 1280`.
    expect(() => withInset({ left: 1280 }, 1280)).toThrow(
      "from 0 to under its width of 1280, got 1280",
    );
    expect(() => withInset({ left: 1279 }, 1280)).not.toThrow();
  });
});

describe("outputSize", () => {
  it("follows the viewport's aspect", () => {
    expect(outputSize({ width: 1440, height: 900 }, 1920)).toEqual({
      width: 1920,
      height: 1200,
    });
    expect(outputSize({ width: 1600, height: 900 }, 1920)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(outputSize({ width: 1000, height: 700 }, 1920)).toEqual({
      width: 1920,
      height: 1344,
    });
  });

  it("always yields an even height, which H.264 requires", () => {
    for (let h = 600; h <= 1000; h += 1) {
      const size = outputSize({ width: 1440, height: h }, 1920);
      expect(size.height % 2).toBe(0);
    }
  });
});

describe("how long a clip of this app should be", () => {
  it("aims at ten seconds unless the app says otherwise", () => {
    expect(resolveConfig({ baseUrl: "http://x" }, "/tmp").review).toEqual({
      minSeconds: 9,
      maxSeconds: 11,
    });
  });

  it("takes the app's word for it", () => {
    // The example app's clips are one interaction each, and four seconds is
    // the honest length for one. A default that called them failures would be
    // a rule about the tool rather than about the clip.
    const config = resolveConfig(
      { baseUrl: "http://x", review: { minSeconds: 4, maxSeconds: 11 } },
      "/tmp",
    );
    expect(config.review).toEqual({ minSeconds: 4, maxSeconds: 11 });
  });
});

describe("webServer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is absent unless the app asks for it", () => {
    // Without one, every command assumes the app is already up, which is how
    // this package behaved before it could start anything.
    expect(resolveConfig({ baseUrl: "http://x" }, ROOT).webServer).toBeNull();
  });

  it("fills every field, waiting on baseUrl from the config's directory", () => {
    vi.stubEnv("CI", "");
    const c = resolveConfig(
      {
        baseUrl: "http://localhost:5174/",
        webServer: { command: "npm run dev" },
      },
      ROOT,
    );
    expect(c.webServer).toEqual({
      command: "npm run dev",
      url: "http://localhost:5174",
      cwd: "/tmp/app",
      timeoutMs: 120_000,
      reuseExistingServer: true,
      env: {},
    });
  });

  it("resolves its cwd against the config's directory", () => {
    // PathGen's stack starts from the repository root, two levels above the
    // workspace its config lives in.
    const c = resolveConfig(
      {
        baseUrl: "http://x",
        webServer: { command: "make start", cwd: "../.." },
      },
      "/repo/app/demos",
    );
    expect(c.webServer?.cwd).toBe("/repo");
  });

  it("will not reuse a server in CI unless told to", () => {
    // Something already answering on a CI runner was not started by this job,
    // so it is not the build under test.
    vi.stubEnv("CI", "true");
    const server = { command: "npm run dev" };
    expect(
      resolveConfig({ baseUrl: "http://x", webServer: server }, ROOT).webServer
        ?.reuseExistingServer,
    ).toBe(false);
    expect(
      resolveConfig(
        {
          baseUrl: "http://x",
          webServer: { ...server, reuseExistingServer: true },
        },
        ROOT,
      ).webServer?.reuseExistingServer,
    ).toBe(true);
  });

  it("names the field it rejected", () => {
    const bad = (webServer: object) => () =>
      resolveConfig(
        { baseUrl: "http://x", webServer: webServer as never },
        ROOT,
      );
    expect(bad({ command: "" })).toThrow(/`webServer.command`/);
    expect(bad({ command: "  " })).toThrow(/`webServer.command`/);
    expect(bad({})).toThrow(/`webServer.command`/);
    expect(bad({ command: "x", timeoutMs: 0 })).toThrow(
      /`webServer.timeoutMs`/,
    );
    expect(bad({ command: "x", timeoutMs: 1.5 })).toThrow(
      /`webServer.timeoutMs`/,
    );
    expect(bad({ command: "x", url: "localhost:5174" })).toThrow(
      /`webServer.url`/,
    );
  });
});
