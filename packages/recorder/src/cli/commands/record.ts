import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { runClip } from "../../driver/clip.js";
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
  const { positionals } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
  });

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

  const browser = await chromium.launch();
  const failures: { id: string; error: Error }[] = [];

  try {
    for (const clip of clips) {
      const started = Date.now();
      try {
        const { timeline } = await runClip(browser, config, clip);
        const seconds = (timeline.durationFrames / timeline.fps).toFixed(1);
        process.stdout.write(
          `  ${clip.id}: ${timeline.durationFrames} frames (${seconds}s), ` +
            `${timeline.states.length} states, ${timeline.cuts.length} cuts ` +
            `— ${((Date.now() - started) / 1000).toFixed(0)}s\n`,
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
      process.stderr.write(`${id}\n  ${error.message}\n\n`);
    }
    return 1;
  }
  return 0;
}
