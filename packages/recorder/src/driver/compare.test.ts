import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Timeline } from "../core/timeline.js";
import { compareRecordings, readRecording, stateFileAt } from "./compare.js";

/** The committed recording of the fixture page: 115 frames over four states. */
const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/recording-buttons",
);

/** A copy, so a test can spoil it without touching the committed original. */
function copy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "versioncam-compare-")), "rec");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("compareRecordings", () => {
  it("finds two copies of one recording identical", () => {
    const result = compareRecordings(
      readRecording(copy()),
      readRecording(copy()),
    );
    expect(result).toEqual({
      frames: 115,
      identical: 115,
      firstDifference: null,
      differing: [],
    });
  });

  it("names the first frame that shows a different picture", () => {
    // State 2 is first shown at frame 74 and last at 78. Change its pixels —
    // here, its bytes — and exactly those five frames differ.
    const spoiled = copy();
    const png = join(spoiled, "states", "0002.png");
    writeFileSync(png, Buffer.concat([readFileSync(png), Buffer.from([0])]));

    const result = compareRecordings(
      readRecording(copy()),
      readRecording(spoiled),
    );
    expect(result.firstDifference).toBe(74);
    expect(result.differing).toEqual([74, 75, 76, 77, 78]);
    expect(result.identical).toBe(110);
    // And where to look: the two images behind that frame.
    expect(stateFileAt(readRecording(spoiled), 74)).toBe(png);
  });

  it("compares by picture, not by how the states were numbered", () => {
    // A gated and an ungated recording of one video number their states
    // differently. Duplicate a state under a new name and point half its
    // frames at the copy: the same video, a different index.
    const renumbered = copy();
    const file = join(renumbered, "timeline.json");
    const timeline = JSON.parse(readFileSync(file, "utf8")) as Timeline;
    cpSync(
      join(renumbered, "states", "0000.png"),
      join(renumbered, "states", "0004.png"),
    );
    const frames = timeline.frames.map((s, i) => (s === 0 && i > 10 ? 4 : s));
    writeFileSync(
      file,
      JSON.stringify({
        ...timeline,
        states: [...timeline.states, "0004.png"],
        frames,
      }),
    );

    const result = compareRecordings(
      readRecording(copy()),
      readRecording(renumbered),
    );
    expect(result.firstDifference).toBeNull();
  });

  it("counts a recording that stops early as different from there on", () => {
    const short = copy();
    const file = join(short, "timeline.json");
    const timeline = JSON.parse(readFileSync(file, "utf8")) as Timeline;
    writeFileSync(
      file,
      JSON.stringify({
        ...timeline,
        durationFrames: 100,
        frames: timeline.frames.slice(0, 100),
      }),
    );

    const result = compareRecordings(
      readRecording(copy()),
      readRecording(short),
    );
    expect(result.frames).toBe(115);
    expect(result.firstDifference).toBe(100);
    expect(result.identical).toBe(100);
  });
});
