import { copyFileSync, mkdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { runClip } from "../../driver/clip.js";
import type { ClipDefinition } from "../../driver/clip.js";
import { compareRecordings, stateFileAt } from "../../driver/compare.js";
import type { RecordingRef } from "../../driver/compare.js";
import { launchBrowser } from "../../driver/launch.js";
import type { ResolvedConfig } from "../../config.js";
import { loadClips, loadConfig } from "../../loader.js";
import { drivingApp } from "../app.js";

/**
 * Does this app record the same way twice?
 *
 * The README's rule — when a clip will not reproduce, record it twice the same
 * way first — as a command, and as the first thing done in a repository before
 * anything is authored for it. A clip is only as deterministic as the app it
 * films: a page that renders the wall-clock time, or animates something the
 * recorder's clock does not drive, gives a different video every run, and
 * every clip written against it will fail CI for reasons nobody wrote.
 *
 * Draft by default, because the question is about the app and not the pixels:
 * a draft is the same page at the same size, a quarter of the frames.
 */
export async function stability(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      runs: { type: "string", default: "2" },
      // Accepted for saying so explicitly; drafting is the default.
      draft: { type: "boolean" },
      full: { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
  });

  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 2) {
    process.stderr.write(
      `--runs must be a whole number of 2 or more, got ${values.runs}.\n`,
    );
    return 1;
  }
  const draft = values.full !== true;

  const config = await loadConfig(process.cwd());
  const clips = await loadClips(config, positionals as string[]);
  if (clips.length === 0) {
    process.stderr.write(
      positionals.length > 0
        ? `No clip matched ${positionals.join(", ")}.\n`
        : `No clips found. The config looks for ${config.clips.join(", ")} under ${config.root}.\n`,
    );
    return 1;
  }

  return drivingApp(config, () => compareRuns(config, clips, runs, draft));
}

async function compareRuns(
  config: ResolvedConfig,
  clips: ClipDefinition[],
  runs: number,
  draft: boolean,
): Promise<number> {
  const browser = await launchBrowser();
  let stable = true;
  try {
    for (const clip of clips) {
      const recordings: RecordingRef[] = [];
      for (let run = 1; run <= runs; run += 1) {
        // Each run in its own directory, beside the real recordings and never
        // over one: the clip's own recording is what `render` and `sheet`
        // read, and a stability check must not replace it.
        const into = join(config.recordingsDir, "__stability", `run-${run}`);
        try {
          const { dir, timeline } = await runClip(
            browser,
            { ...config, recordingsDir: into },
            clip,
            { draft },
          );
          recordings.push({ dir, timeline });
        } catch (error) {
          process.stdout.write(
            `${clip.id}: run ${run} did not record — ${(error as Error).message}\n`,
          );
          return 1;
        }
      }

      for (let run = 1; run < runs; run += 1) {
        const [a, b] = [recordings[run - 1], recordings[run]];
        const result = compareRecordings(a, b);
        const pair = `${clip.id}: run ${run} vs run ${run + 1}`;
        if (result.firstDifference === null) {
          process.stdout.write(
            `${pair} — ${result.frames} frames, ${result.identical} identical\n`,
          );
          continue;
        }
        stable = false;
        const frame = result.firstDifference;
        process.stdout.write(
          `${pair} — ${result.frames} frames, ${result.identical} identical, ` +
            `first difference at frame ${frame}\n`,
        );
        // The two pictures behind that frame, side by side on disk: what
        // differs is almost always obvious once seen, and never from a hash.
        const out = join(config.outDir, "stability", clip.id);
        mkdirSync(out, { recursive: true });
        for (const [index, recording] of [
          [run, a],
          [run + 1, b],
        ] as const) {
          const state = stateFileAt(recording, frame);
          if (!state) {
            process.stdout.write(`  run ${index} has no frame ${frame}\n`);
            continue;
          }
          const copy = join(out, `frame-${frame}-run${index}${extname(state)}`);
          copyFileSync(state, copy);
          process.stdout.write(`  ${relative(process.cwd(), copy)}\n`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(
    stable
      ? "stable\n"
      : "unstable — something on this page does not run on authored time\n",
  );
  return stable ? 0 : 1;
}
