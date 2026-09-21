import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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

export type SequenceInput = { id: string; path: string; duration: number };

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

/**
 * The `xfade` chain. Each transition's `offset` is measured from the start of
 * everything accumulated so far, and every crossfade shortens the total by its
 * own duration — which is the part that is easy to get wrong and shows up as
 * a clip that starts before the previous one has finished.
 */
export function buildFilter(inputs: SequenceInput[]): {
  filter: string;
  label: string;
  total: number;
} {
  if (inputs.length === 1)
    return { filter: "", label: "0:v", total: inputs[0].duration };

  const parts: string[] = [];
  let current = "0:v";
  let accumulated = inputs[0].duration;

  for (let i = 1; i < inputs.length; i += 1) {
    const offset = accumulated - TRANSITION_S;
    const label = i === inputs.length - 1 ? "out" : `x${i}`;
    parts.push(
      `[${current}][${i}:v]xfade=transition=fade:duration=${TRANSITION_S}:offset=${offset.toFixed(3)}[${label}]`,
    );
    current = label;
    accumulated += inputs[i].duration - TRANSITION_S;
  }

  return { filter: parts.join(";"), label: current, total: accumulated };
}

export async function buildSequence(
  ids: readonly string[],
  outDir: string,
): Promise<{ path: string; total: number; used: string[]; missing: string[] }> {
  const missing: string[] = [];
  const inputs: SequenceInput[] = [];

  for (const id of ids) {
    const path = join(outDir, `${id}.mp4`);
    if (!existsSync(path) || statSync(path).size < 1000) {
      missing.push(id);
      continue;
    }
    inputs.push({ id, path, duration: probeDuration(path) });
  }

  if (inputs.length < 2) {
    throw new Error(
      `Need at least two rendered clips to build a sequence; have ${inputs.length}.`,
    );
  }

  const { filter, label, total } = buildFilter(inputs);
  const out = join(outDir, "sequence.mp4");

  await new Promise<void>((resolve, reject) => {
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
        out,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sequence failed:\n${stderr.slice(-1200)}`));
    });
  });

  return { path: out, total, used: inputs.map((i) => i.id), missing };
}
