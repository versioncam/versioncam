import { parseArgs } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "../../driver/launch.js";
import { loadConfig } from "../../loader.js";
import { readTimeline, renderFrame } from "../../render/render.js";

/**
 * One frame of a recording, at the size it will be published.
 *
 * The command a reviewer reaches for when a contact sheet's tile is too small
 * to be sure — is that caption legible, is that control inside the camera —
 * and the answer has to be the real frame rather than a scaled-down one.
 */
export async function frame(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { t: { type: "string" } },
    strict: false,
    allowPositionals: true,
  });

  const [id, nth] = positionals as string[];
  const byTime = values.t as string | undefined;
  if (!id || (nth === undefined && byTime === undefined)) {
    process.stderr.write(
      "Usage: versioncam frame <id> <n>  (or --t <seconds>)\n",
    );
    return 1;
  }

  const config = await loadConfig(process.cwd());
  const dir = join(config.recordingsDir, id);
  if (!existsSync(join(dir, "timeline.json"))) {
    process.stderr.write(
      `No recording for "${id}". Run \`versioncam record ${id}\` first.\n`,
    );
    return 1;
  }

  // Seconds are converted here rather than in the renderer: the frame rate is
  // the recording's, and the printed file name should say which frame the time
  // turned out to be.
  const timeline = await readTimeline(config, id);
  const wanted =
    byTime !== undefined
      ? Math.round(Number(byTime) * timeline.fps)
      : Number(nth);
  if (!Number.isFinite(wanted)) {
    process.stderr.write(`Not a frame: ${byTime ?? nth}\n`);
    return 1;
  }

  const browser = await launchBrowser();
  try {
    const png = await renderFrame(
      browser,
      config,
      { kind: "recording", id, dir },
      wanted,
    );
    mkdirSync(config.outputDir, { recursive: true });
    const file = join(config.outputDir, `${id}-frame-${wanted}.png`);
    writeFileSync(file, png);
    process.stdout.write(`${file}\n`);
    return 0;
  } finally {
    await browser.close();
  }
}
