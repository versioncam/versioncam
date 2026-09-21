import { parseArgs } from "node:util";
import { launchBrowser } from "../../driver/launch.js";
import { runClip } from "../../driver/clip.js";
import { loadClips, loadConfig } from "../../loader.js";

/**
 * Record every clip and report which still work.
 *
 * This is the command a CI job runs. It does not render — a demo that no
 * longer matches the app fails while being recorded, at the step that no
 * longer exists, and encoding a video of the wreckage helps nobody.
 */
export async function check(argv: string[]): Promise<number> {
  const { positionals } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
  });

  const config = await loadConfig(process.cwd());
  const clips = await loadClips(config, positionals as string[]);

  if (clips.length === 0) {
    process.stderr.write("No clips to check.\n");
    return 1;
  }

  const browser = await launchBrowser();
  const failures: { id: string; error: Error }[] = [];

  try {
    for (const clip of clips) {
      try {
        await runClip(browser, config, clip);
        process.stdout.write(`PASS  ${clip.id}\n`);
      } catch (error) {
        failures.push({ id: clip.id, error: error as Error });
        process.stdout.write(`FAIL  ${clip.id}\n`);
      }
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(
    `\n${clips.length - failures.length}/${clips.length} clips still match the app.\n`,
  );
  for (const { id, error } of failures) {
    process.stderr.write(`\n${id}\n  ${error.message}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}
