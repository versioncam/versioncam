import { parseArgs } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "../../driver/launch.js";
import { loadConfig, loadSceneIds } from "../../loader.js";
import { renderRecording, renderScene } from "../../render/render.js";
import { buildSequence } from "../../render/sequence.js";

/** Recordings on disk, newest config first, filtered by substring. */
function recordedIds(recordingsDir: string, only: string[]): string[] {
  if (!existsSync(recordingsDir)) return [];
  return readdirSync(recordingsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => existsSync(join(recordingsDir, id, "timeline.json")))
    .filter((id) => only.length === 0 || only.some((n) => id.includes(n)))
    .sort();
}

export async function render(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      scene: { type: "string", multiple: true },
      sequence: { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
  });

  const config = await loadConfig(process.cwd());
  const only = positionals as string[];
  const wantedScenes = (values.scene as string[] | undefined) ?? [];

  // With no `--scene`, every scene the app defines is rendered too: a config
  // that names a scenes module means those scenes are part of the deliverable.
  const sceneIds =
    wantedScenes.length > 0 ? wantedScenes : await loadSceneIds(config);
  const recordings = recordedIds(config.recordingsDir, only);

  if (recordings.length === 0 && sceneIds.length === 0) {
    process.stderr.write(
      `Nothing to render. Run \`demos record\` first — recordings live in ${config.recordingsDir}.\n`,
    );
    return 1;
  }

  const browser = await launchBrowser();
  const rendered: string[] = [];
  const failures: { id: string; error: Error }[] = [];

  try {
    for (const id of recordings) {
      try {
        const out = await renderRecording(browser, config, id);
        rendered.push(id);
        process.stdout.write(
          `  ${id}: ${out.durationFrames} frames at ${out.fps}fps ` +
            `(${(out.durationFrames / out.fps).toFixed(1)}s)\n`,
        );
      } catch (error) {
        failures.push({ id, error: error as Error });
      }
    }
    for (const id of sceneIds) {
      if (only.length > 0 && !only.some((n) => id.includes(n))) continue;
      try {
        const out = await renderScene(browser, config, id);
        rendered.push(id);
        process.stdout.write(
          `  ${id} (scene): ${out.durationFrames} frames at ${out.fps}fps\n`,
        );
      } catch (error) {
        failures.push({ id, error: error as Error });
      }
    }
  } finally {
    await browser.close();
  }

  if (values.sequence && rendered.length >= 2) {
    // The config's order when it states one, since a sequence is an argument
    // and not an accident of how the directory happens to sort.
    const order = config.sequence ?? rendered;
    const result = await buildSequence(
      order.filter((id) => rendered.includes(id)),
      config.outputDir,
    );
    process.stdout.write(
      `  sequence: ${result.used.length} clips, ${result.total.toFixed(1)}s\n`,
    );
    if (result.missing.length > 0) {
      process.stdout.write(`  (not rendered: ${result.missing.join(", ")})\n`);
    }
  } else if (values.sequence) {
    process.stderr.write("  sequence needs at least two rendered clips.\n");
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
