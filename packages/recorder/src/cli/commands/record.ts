import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser } from "../../driver/launch.js";
import { runClip } from "../../driver/clip.js";
import { formatTiming } from "../../core/timing.js";
import { loadClips, loadConfig } from "../../loader.js";

/**
 * Record every clip the config points at, serially.
 *
 * Serial by necessity rather than by caution: clips drive one app, and apps
 * commonly hold per-session server state that two concurrent recordings
 * corrupt. A failure does not stop the run — the other clips are still worth
 * having, and a report of which ones broke is more useful than the first
 * error alone.
 */
export async function record(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { draft: { type: "boolean", default: false } },
    strict: false,
    allowPositionals: true,
  });
  const draft = values.draft === true;

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

  const browser = await launchBrowser();
  const failures: { id: string; error: Error }[] = [];

  try {
    for (const clip of clips) {
      const started = Date.now();
      try {
        const { timeline, cost } = await runClip(browser, config, clip, {
          draft,
        });
        // Both seconds are named. The line used to print "(7.5s) … — 2.6s" and
        // leave the reader to work out that the first is the clip and the
        // second is the machine; they move in opposite directions when a clip
        // gets slower to record, which makes guessing worse than useless.
        const plays = (timeline.durationFrames / timeline.fps).toFixed(1);
        const took = ((Date.now() - started) / 1000).toFixed(1);
        process.stdout.write(
          `  ${clip.id}${draft ? " (draft)" : ""}: ${timeline.durationFrames} frames, ` +
            `${timeline.states.length} states, ${timeline.cuts.length} cuts ` +
            `— plays ${plays}s · took ${took}s\n` +
            `    ${formatTiming(cost)}\n`,
        );
      } catch (error) {
        failures.push({ id: clip.id, error: error as Error });
        process.stdout.write(`  ${clip.id}: FAILED\n`);
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    process.stderr.write("\n");
    for (const { id, error } of failures) {
      // The message says what broke; the picture says why. An authoring agent
      // spent two of its three attempts reasoning about plausible causes —
      // timing races, mount races, drag granularity — for a failure that was
      // obvious in one look at the screenshot: its drag had landed on the
      // chart's axis labels instead of the brush. It had been told to read the
      // file and still treated it as a secondary check, because nothing at the
      // moment of failure said the file was there. Now it does.
      const shot = join(config.recordingsDir, id, "failure.png");
      const picture = existsSync(shot)
        ? `\n  the page when it gave up: ${shot}`
        : "";
      process.stderr.write(`${id}\n  ${error.message}${picture}\n\n`);
    }
    return 1;
  }
  return 0;
}
