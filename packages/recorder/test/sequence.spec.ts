import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegPath, ffprobeSync } from "../src/render/ffmpeg.js";
import { buildSequence } from "../src/render/sequence.js";

/**
 * Stitching, with no browser: the clips are ffmpeg's own test pattern, so a
 * test can choose what is wrong with them.
 */

/**
 * A second of the test pattern at `size`, as `<id>.mp4` in `dir`, with the
 * MP4 timescale `timescale` when one is given.
 */
function writeClip(
  dir: string,
  id: string,
  size: string,
  timescale?: number,
): void {
  execFileSync(ffmpegPath(), [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=${size}:rate=60:duration=1`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    ...(timescale ? ["-video_track_timescale", String(timescale)] : []),
    join(dir, `${id}.mp4`),
  ]);
}

/**
 * Two clips `xfade` will not join: one size and one rate, so the sequence
 * hands them to ffmpeg, but two timebases, which `xfade` refuses as well.
 * ffmpeg opens its output before it finds that out: written straight to
 * sequence.mp4, a sequence of these emptied the film an earlier run had
 * made, and left an empty file where there had been none. (These were
 * clips of two sizes until a sequence refused those before ffmpeg ran.)
 */
function clipsFfmpegRefuses(): string {
  const dir = mkdtempSync(join(tmpdir(), "versioncam-sequence-"));
  writeClip(dir, "a", "320x240");
  writeClip(dir, "b", "320x240", 90_000);
  return dir;
}

test.describe("stitching a sequence", () => {
  test("refuses clips of two sizes before ffmpeg runs, and says which", async () => {
    // A phone clip among desktop ones, most likely. ffmpeg's own error is a
    // screen of filter graph; this one names the clips.
    const dir = mkdtempSync(join(tmpdir(), "versioncam-sequence-"));
    writeClip(dir, "a", "320x240");
    writeClip(dir, "b", "240x320");
    await expect(buildSequence(["a", "b"], dir)).rejects.toThrow(
      "A sequence stitches clips of one size: a is 320x240 and b is 240x320. " +
        'Leave the phone clips out of "sequence".',
    );
    expect(readdirSync(dir).sort()).toEqual(["a.mp4", "b.mp4"]);
  });

  test("a sequence that fails leaves nothing where there was nothing", async () => {
    const dir = clipsFfmpegRefuses();
    const error = await buildSequence(["a", "b"], dir).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("sequence failed:");
    expect((error as Error).message).not.toContain("earlier run");
    expect(readdirSync(dir).sort()).toEqual(["a.mp4", "b.mp4"]);
  });

  test("a sequence that fails leaves the one before it as it was", async () => {
    const dir = clipsFfmpegRefuses();
    const film = join(dir, "sequence.mp4");
    const earlier = readFileSync(join(dir, "a.mp4"));
    writeFileSync(film, earlier);

    await expect(buildSequence(["a", "b"], dir)).rejects.toThrow(
      `${film} is from an earlier run, left as it was.`,
    );
    expect(readFileSync(film).equals(earlier)).toBe(true);
    // Nothing half-made beside it either.
    expect(readdirSync(dir).sort()).toEqual(["a.mp4", "b.mp4", "sequence.mp4"]);
  });

  test("a sequence that succeeds takes the place of the one before it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versioncam-sequence-"));
    writeClip(dir, "a", "320x240");
    writeClip(dir, "b", "320x240");
    writeFileSync(join(dir, "sequence.mp4"), "an earlier film");

    const { path } = await buildSequence(["a", "b"], dir);
    expect(path).toBe(join(dir, "sequence.mp4"));
    // Both seconds, less one crossfade of 24 frames.
    const frames = ffprobeSync([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "default=nw=1:nk=1",
      path,
    ]).trim();
    expect(Number(frames)).toBe(60 + 60 - 24);
    expect(readdirSync(dir).sort()).toEqual(["a.mp4", "b.mp4", "sequence.mp4"]);
  });
});
