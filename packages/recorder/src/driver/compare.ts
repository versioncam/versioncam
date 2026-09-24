import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Timeline } from "../core/timeline.js";

/**
 * Are two recordings of the same clip the same video?
 *
 * The README's rule — when a clip will not reproduce, record it twice the
 * same way first — as a function, because two places need the answer: the
 * `stability` command, which asks it of an app before anything is authored
 * for it, and the example app's gate test, which asks it of the recorder.
 *
 * Frame by frame, by what each frame shows: the state image behind it,
 * hashed. Not by state index or state count, which differ between a gated and
 * an ungated recording of an identical video; and not by the timeline, whose
 * cursor, camera and captions are the driver's own decisions and identical by
 * construction. The pixels are what the app drew, so they are what can vary.
 */

/** A recording on disk: the directory and the timeline it holds. */
export type RecordingRef = { dir: string; timeline: Timeline };

export type Comparison = {
  /** The longer of the two, so a recording that stops early differs. */
  frames: number;
  identical: number;
  firstDifference: number | null;
  differing: number[];
};

/** Read the recording `runClip` wrote into `dir`. */
export function readRecording(dir: string): RecordingRef {
  const timeline = JSON.parse(
    readFileSync(join(dir, "timeline.json"), "utf8"),
  ) as Timeline;
  return { dir, timeline };
}

/** What each frame shows, as a hash of the state image behind it. */
export function frameHashes(recording: RecordingRef): string[] {
  const states = recording.timeline.states.map((name) =>
    createHash("sha1")
      .update(readFileSync(join(recording.dir, "states", name)))
      .digest("hex"),
  );
  return recording.timeline.frames.map((index) => states[index]);
}

/** The state image a frame shows, or null past the recording's end. */
export function stateFileAt(
  recording: RecordingRef,
  frame: number,
): string | null {
  const index = recording.timeline.frames[frame];
  if (index === undefined) return null;
  return join(recording.dir, "states", recording.timeline.states[index]);
}

export function compareRecordings(
  a: RecordingRef,
  b: RecordingRef,
): Comparison {
  const left = frameHashes(a);
  const right = frameHashes(b);
  const frames = Math.max(left.length, right.length);
  const differing: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    if (left[frame] === undefined || left[frame] !== right[frame]) {
      differing.push(frame);
    }
  }
  return {
    frames,
    identical: frames - differing.length,
    firstDifference: differing[0] ?? null,
    differing,
  };
}
