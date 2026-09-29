import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import {
  pngSize,
  publishedRenderConfig,
  readClip,
  sha256Hex,
} from "./manifest.js";

const FIXTURE = resolve(
  import.meta.dirname,
  "../../test/fixtures/recording-buttons",
);

function config() {
  return resolveConfig(
    {
      baseUrl: "http://fixture.local",
      viewport: { width: 1000, height: 700 },
      theme: { accent: "#123456" },
    },
    tmpdir(),
  );
}

function copyOfFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "versioncam-manifest-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("a recording's manifest", () => {
  it("describes every state by its hash, size and dimensions, in order", () => {
    const renderConfig = publishedRenderConfig(config());
    const read = readClip(FIXTURE, { id: "buttons", title: "" }, renderConfig);
    const timeline = JSON.parse(
      readFileSync(join(FIXTURE, "timeline.json"), "utf8"),
    ) as { states: string[]; fps: number; durationFrames: number };

    expect(read?.manifest.check).toEqual({ status: "pass" });
    const recording = read?.manifest.recording;
    expect(recording?.states).toHaveLength(timeline.states.length);
    const first = readFileSync(join(FIXTURE, "states", timeline.states[0]));
    expect(recording?.states[0]).toEqual({
      hash: sha256Hex(first),
      bytes: first.length,
      ...pngSize(first),
    });
    expect(recording?.fps).toBe(timeline.fps);
    expect(recording?.durationFrames).toBe(timeline.durationFrames);
    expect(recording?.renderConfig).toBe(renderConfig);
  });

  it("takes its title from the timeline when the clip gives none", () => {
    const read = readClip(
      FIXTURE,
      { id: "buttons", title: "" },
      publishedRenderConfig(config()),
    );
    const timeline = JSON.parse(
      readFileSync(join(FIXTURE, "timeline.json"), "utf8"),
    ) as { meta: { title: string } };
    expect(read?.manifest.title).toBe(timeline.meta.title);
  });

  it("hashes to the same content twice, and ignores when it was recorded", () => {
    const renderConfig = publishedRenderConfig(config());
    const once = readClip(FIXTURE, { id: "b", title: "" }, renderConfig);

    // The same recording made again later, against another commit of the app:
    // nothing it shows is different, so the service must see it as unchanged.
    const again = copyOfFixture();
    const file = join(again, "timeline.json");
    const timeline = JSON.parse(readFileSync(file, "utf8"));
    timeline.meta.recordedAt = "2031-01-01T00:00:00.000Z";
    timeline.meta.appCommit = "abcdef0";
    writeFileSync(file, JSON.stringify(timeline));
    const twice = readClip(again, { id: "b", title: "" }, renderConfig);

    expect(twice?.manifest.recording?.contentHash).toBe(
      once?.manifest.recording?.contentHash,
    );
    // The file itself did change, and is uploaded as it is.
    expect(twice?.manifest.recording?.timelineHash).not.toBe(
      once?.manifest.recording?.timelineHash,
    );
  });

  it("changes its content hash when a state's pixels change", () => {
    const renderConfig = publishedRenderConfig(config());
    const once = readClip(FIXTURE, { id: "b", title: "" }, renderConfig);
    const changed = copyOfFixture();
    const timeline = JSON.parse(
      readFileSync(join(changed, "timeline.json"), "utf8"),
    ) as { states: string[] };
    // The last state swapped for the first: same timeline, different screen.
    cpSync(
      join(changed, "states", timeline.states[0]),
      join(changed, "states", timeline.states.at(-1) as string),
    );
    const twice = readClip(changed, { id: "b", title: "" }, renderConfig);
    expect(twice?.manifest.recording?.contentHash).not.toBe(
      once?.manifest.recording?.contentHash,
    );
  });

  it("changes its content hash when the render config changes", () => {
    const a = readClip(
      FIXTURE,
      { id: "b", title: "" },
      publishedRenderConfig(config()),
    );
    const other = resolveConfig(
      {
        baseUrl: "http://fixture.local",
        viewport: { width: 1000, height: 700 },
        theme: { accent: "#654321" },
      },
      tmpdir(),
    );
    const b = readClip(
      FIXTURE,
      { id: "b", title: "" },
      publishedRenderConfig(other),
    );
    expect(b?.manifest.recording?.contentHash).not.toBe(
      a?.manifest.recording?.contentHash,
    );
  });

  it("reports a failed run, with its step, and no recording", () => {
    const dir = copyOfFixture();
    writeFileSync(
      join(dir, "failure.json"),
      JSON.stringify({
        message: "Nothing matched the button",
        frame: 12,
        t: 0.8,
        step: { index: 3, call: "click" },
      }),
    );
    const picture = readFileSync(join(FIXTURE, "states", "0000.png"));
    writeFileSync(join(dir, "failure.png"), picture);

    const read = readClip(
      dir,
      { id: "b", title: "Buttons" },
      publishedRenderConfig(config()),
    );
    expect(read?.manifest.check).toEqual({
      status: "fail",
      message: "Nothing matched the button",
      step: { index: 3, call: "click" },
      frame: 12,
      t: 0.8,
    });
    expect(read?.manifest.recording).toBeNull();
    expect(read?.manifest.failureHash).toBe(sha256Hex(picture));
  });

  it("says nothing about a clip that was never recorded", () => {
    const empty = mkdtempSync(join(tmpdir(), "versioncam-manifest-"));
    expect(
      readClip(empty, { id: "b", title: "" }, publishedRenderConfig(config())),
    ).toBeNull();
  });

  it("leaves the scenes module out of the render config", () => {
    const withScenes = resolveConfig(
      { baseUrl: "http://fixture.local", scenes: "demos/scenes.ts" },
      tmpdir(),
    );
    const published = publishedRenderConfig(withScenes);
    expect(published).not.toHaveProperty("scenes");
    expect(published.clock).toEqual({
      timezoneId: withScenes.clock.timezoneId,
      locale: withScenes.clock.locale,
    });
  });
});

describe("a PNG's size", () => {
  it("is read from the header", () => {
    const png = readFileSync(join(FIXTURE, "states", "0000.png"));
    const { width, height } = pngSize(png);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("refuses what is not a PNG", () => {
    expect(() => pngSize(Buffer.from("not a png at all, clearly"))).toThrow(
      "not a PNG",
    );
  });
});
