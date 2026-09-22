import { describe, expect, it } from "vitest";
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
    expect(c.outDir).toBe("/tmp/app/.demos");
    expect(c.recordingsDir).toBe("/tmp/app/.demos/recordings");
    expect(c.outputDir).toBe("/tmp/app/.demos/out");
    expect(c.cacheDir).toBe("/tmp/app/.demos/.cache");
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
