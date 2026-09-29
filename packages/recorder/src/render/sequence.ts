import { REPRODUCIBLE, threadArgs } from "./encode.js";
import { spawn } from "node:child_process";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { ffmpegPath, ffprobeSync } from "./ffmpeg.js";

/**
 * Stitches finished clips into one continuous piece.
 *
 * Done with ffmpeg's `xfade` over the already-encoded clips rather than by
 * re-rendering a combined timeline. Re-rendering would mean holding every
 * clip's frames in one browser page at once for no gain in quality, and the
 * clips have to stand alone anyway — the sequence is an arrangement of
 * finished things, not another thing.
 *
 * No title cards between clips: each already carries its own caption, and a
 * card per clip adds a sixth of the running time for nothing.
 */

const TRANSITION_S = 0.4;

/**
 * A rendered clip. `frameRate` is the fraction ffprobe gives, `60/1` or
 * `30000/1001`, kept as written rather than divided out: it is the rate the
 * filter may convert every clip to, the fastest clip included, and only the
 * exact rate leaves that clip's frames where they were.
 */
export type SequenceInput = {
  id: string;
  path: string;
  duration: number;
  frameRate: string;
};

/** Duration of a video file, in seconds. Blocking; ffprobe is quick. */
export function probeDuration(path: string): number {
  const out = ffprobeSync([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path,
  ]);
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`Could not read a duration from ${path}`);
  }
  return seconds;
}

/** Frame rate of a video file, as the fraction ffprobe gives. Blocking too. */
export function probeFrameRate(path: string): string {
  const out = ffprobeSync([
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=r_frame_rate",
    "-of",
    "default=nw=1:nk=1",
    path,
  ]).trim();
  const rate = rateOf(out);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Could not read a frame rate from ${path}`);
  }
  return out;
}

/** A fraction as ffprobe prints one, `30000/1001`, as a number. */
function rateOf(fraction: string): number {
  const [num, den = "1"] = fraction.split("/");
  return Number(num) / Number(den);
}

/**
 * The `xfade` chain. Each transition's `offset` is measured from the start of
 * everything accumulated so far, and every crossfade shortens the total by its
 * own duration — which is the part that is easy to get wrong and shows up as
 * a clip that starts before the previous one has finished.
 *
 * `xfade` joins streams of one frame rate and one timebase only, and clips
 * need not share a rate: a 15 fps draft among 60 fps recordings, or a scene
 * or a clip with an `fps` of its own. When the rates differ, every clip goes
 * through `fps` at the highest of them first. The highest, so that no clip
 * loses a frame: a slower clip's frames are each held as long as they were.
 * Every clip, the fastest included, because `fps` sets the timebase as well,
 * and a clip left alone would keep its own. When the rates agree, the filter
 * is the one it always was.
 */
export function buildFilter(inputs: SequenceInput[]): {
  filter: string;
  label: string;
  total: number;
} {
  if (inputs.length === 1)
    return { filter: "", label: "0:v", total: inputs[0].duration };

  const parts: string[] = [];
  const rates = inputs.map((input) => rateOf(input.frameRate));
  const mixed = new Set(rates).size > 1;
  if (mixed) {
    const highest = inputs[rates.indexOf(Math.max(...rates))].frameRate;
    inputs.forEach((_, i) => parts.push(`[${i}:v]fps=${highest}[f${i}]`));
  }
  const stream = (i: number) => (mixed ? `f${i}` : `${i}:v`);

  let current = stream(0);
  let accumulated = inputs[0].duration;

  for (let i = 1; i < inputs.length; i += 1) {
    const offset = accumulated - TRANSITION_S;
    const label = i === inputs.length - 1 ? "out" : `x${i}`;
    parts.push(
      `[${current}][${stream(i)}]xfade=transition=fade:duration=${TRANSITION_S}:offset=${offset.toFixed(3)}[${label}]`,
    );
    current = label;
    accumulated += inputs[i].duration - TRANSITION_S;
  }

  return { filter: parts.join(";"), label: current, total: accumulated };
}

export async function buildSequence(
  ids: readonly string[],
  outDir: string,
  options: { threads?: number | null } = {},
): Promise<{ path: string; total: number; used: string[]; missing: string[] }> {
  const missing: string[] = [];
  const inputs: SequenceInput[] = [];

  for (const id of ids) {
    const path = join(outDir, `${id}.mp4`);
    if (!existsSync(path) || statSync(path).size < 1000) {
      missing.push(id);
      continue;
    }
    inputs.push({
      id,
      path,
      duration: probeDuration(path),
      frameRate: probeFrameRate(path),
    });
  }

  if (inputs.length < 2) {
    throw new Error(
      `Need at least two rendered clips to build a sequence; have ${inputs.length}.`,
    );
  }

  const { filter, label, total } = buildFilter(inputs);
  const out = join(outDir, "sequence.mp4");
  // Made beside the film and moved over it once ffmpeg has finished. ffmpeg
  // opens its output before it finds out whether it can join the clips, and
  // a sequence written straight to sequence.mp4 that failed left it empty,
  // whatever film had been there. `.mp4` last: ffmpeg picks the muxer by it.
  const partial = join(outDir, "sequence.partial.mp4");

  let stderr = "";
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(
      ffmpegPath(),
      [
        "-y",
        ...inputs.flatMap((input) => ["-i", input.path]),
        "-filter_complex",
        filter,
        "-map",
        `[${label}]`,
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        ...REPRODUCIBLE,
        ...threadArgs(options.threads),
        partial,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", resolve);
  });

  if (code !== 0) {
    rmSync(partial, { force: true });
    // The film still there is not this sequence, and could pass for it.
    const kept = existsSync(out)
      ? `\n${out} is from an earlier run, left as it was.`
      : "";
    throw new Error(`sequence failed:\n${stderr.slice(-1200)}${kept}`);
  }
  renameSync(partial, out);

  return { path: out, total, used: inputs.map((i) => i.id), missing };
}
