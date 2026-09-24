import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "../../driver/launch.js";
import { loadConfig } from "../../loader.js";
import { contactSheet, readTimeline } from "../../render/render.js";
import { markedFrames } from "../../render/sampling.js";

export async function sheet(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { "at-marks": { type: "boolean", default: false } },
    strict: false,
    allowPositionals: true,
  });
  const id = positionals[0] as string | undefined;
  if (!id) {
    process.stderr.write("Usage: versioncam sheet <id> [--at-marks]\n");
    return 1;
  }

  const config = await loadConfig(process.cwd());
  const dir = join(config.recordingsDir, id);
  if (!existsSync(join(dir, "timeline.json"))) {
    process.stderr.write(`No recording for "${id}".\n`);
    return 1;
  }

  let frames: number[] | undefined;
  if (values["at-marks"] === true) {
    const timeline = await readTimeline(config, id);
    // A recording made before marks existed has none, and then this is the
    // first frame and the last one — which is honest: there are no beats to
    // aim at, and saying so beats inventing eight.
    frames = markedFrames(
      timeline.durationFrames,
      timeline.marks ?? [],
      undefined,
      config.motion.crossfadeFrames,
      timeline.cuts,
    );
  }

  const browser = await launchBrowser();
  try {
    const file = await contactSheet(
      browser,
      config,
      { kind: "recording", id, dir },
      { frames },
    );
    // The path first, on its own line: everything that calls this reads it.
    process.stdout.write(`${file}\n`);
    if (frames) {
      process.stdout.write(`frames ${frames.join(" · ")}\n`);
    }
    return 0;
  } finally {
    await browser.close();
  }
}
