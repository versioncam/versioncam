import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Timeline } from "../../core/timeline.js";
import type { SettleReport } from "../../driver/settle.js";
import { loadConfig } from "../../loader.js";
import { formatReview, reviewRecording } from "../../review/review.js";
import type { Beat } from "../../review/review.js";

const USAGE =
  "Usage: demos review <id> [--beats <file>] [--min <s>] [--max <s>]\n";

/** The beat sheet, checked as it is read: a bad one is an authoring mistake. */
function readBeats(file: string): Beat[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must be an array of { label, expect }.`);
  }
  return parsed.map((entry, index) => {
    const beat = entry as Partial<Beat>;
    if (typeof beat?.label !== "string" || beat.label.length === 0) {
      throw new Error(`${file}: beat ${index} has no \`label\`.`);
    }
    return { label: beat.label, expect: beat.expect };
  });
}

function bound(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    throw new Error(`--${flag} must be a number of seconds, got "${value}".`);
  }
  return seconds;
}

/**
 * Check a recording against what it was supposed to be — without a model, and
 * without a browser. Everything here is in the files the recording left
 * behind, which is what makes it something CI can run.
 */
export async function review(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      beats: { type: "string" },
      min: { type: "string" },
      max: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  const id = positionals[0] as string | undefined;
  if (!id) {
    process.stderr.write(USAGE);
    return 1;
  }

  const config = await loadConfig(process.cwd());
  const dir = join(config.recordingsDir, id);
  const timelineFile = join(dir, "timeline.json");
  if (!existsSync(timelineFile)) {
    process.stderr.write(
      `No recording for "${id}". Run \`demos record ${id}\` first.\n`,
    );
    return 1;
  }

  const recorded = JSON.parse(readFileSync(timelineFile, "utf8")) as Timeline;
  const settlesFile = join(dir, "settles.json");
  const settles = existsSync(settlesFile)
    ? (JSON.parse(readFileSync(settlesFile, "utf8")) as SettleReport[])
    : [];

  let beats: Beat[] = [];
  if (typeof values.beats === "string") {
    const file = resolve(process.cwd(), values.beats);
    if (!existsSync(file)) {
      process.stderr.write(`No beat sheet at ${file}.\n`);
      return 1;
    }
    beats = readBeats(file);
  }

  const result = reviewRecording({
    // A recording made before marks existed has none, and then the beat and
    // progress clauses have nothing to work with — which they say.
    timeline: { ...recorded, marks: recorded.marks ?? [] },
    settles,
    beats,
    bounds: {
      minSeconds: bound(values.min, "min"),
      maxSeconds: bound(values.max, "max"),
    },
  });

  process.stdout.write(`${formatReview(id, result)}\n`);
  return result.pass ? 0 : 1;
}
