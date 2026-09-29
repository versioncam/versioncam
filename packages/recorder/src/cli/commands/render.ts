import { parseArgs } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchBrowser } from "../../driver/launch.js";
import { loadConfig, loadSceneIds } from "../../loader.js";
import { renderRecording, renderScene } from "../../render/render.js";
import { missingScenes } from "../../render/scenes.js";
import { buildSequence } from "../../render/sequence.js";
import { writeReport } from "./publish.js";
import { RECORDER_VERSION } from "../../driver/clip.js";

/** Every recording on disk, by id. */
function recordedIds(recordingsDir: string): string[] {
  if (!existsSync(recordingsDir)) return [];
  return readdirSync(recordingsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => existsSync(join(recordingsDir, id, "timeline.json")))
    .sort();
}

/**
 * What `render` renders, from what there is and what was asked for.
 *
 * Ids are substrings, as everywhere else (`render 05` is the clip with 05 in
 * its id), and they choose among the recordings and the scenes alike. A
 * `--scene` names one scene exactly, and it renders whatever the ids say: it
 * used to be filtered by them as well, so `render 02 04 --scene 01-intro`
 * rendered no scene at all. With no ids, every recording on disk renders,
 * and every scene unless `--scene` named the ones wanted.
 *
 * `unmatched` is the ids that choose nothing.
 */
export function chooseTargets(
  recorded: string[],
  defined: string[],
  ids: string[],
  named: string[],
): { recordings: string[]; scenes: string[]; unmatched: string[] } {
  const matches = (id: string) => ids.some((n) => id.includes(n));
  return {
    recordings: ids.length > 0 ? recorded.filter(matches) : recorded,
    scenes: defined.filter(
      (id) =>
        named.includes(id) ||
        (ids.length > 0 ? matches(id) : named.length === 0),
    ),
    unmatched: ids.filter(
      (n) =>
        !recorded.some((id) => id.includes(n)) &&
        !defined.some((id) => id.includes(n)),
    ),
  };
}

export async function render(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      scene: { type: "string", multiple: true },
      sequence: { type: "boolean" },
      report: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  const config = await loadConfig(process.cwd());
  const ids = positionals as string[];
  const named = (values.scene as string[] | undefined) ?? [];

  // Everything asked for is checked before anything renders. A render takes
  // minutes, and the output of one missing a clip looks finished: a film
  // stitched from four clips of six says nothing about the other two.
  const defined = await loadSceneIds(config);
  const unknown = named.filter((id) => !defined.includes(id));
  if (unknown.length > 0) {
    process.stderr.write(`${missingScenes(unknown, defined, config.scenes)}\n`);
    return 1;
  }

  const recorded = recordedIds(config.recordingsDir);
  const { recordings, scenes, unmatched } = chooseTargets(
    recorded,
    defined,
    ids,
    named,
  );

  // An id that chooses nothing is a typo, or a clip not recorded yet.
  if (unmatched.length > 0) {
    for (const id of unmatched) {
      process.stderr.write(`No recording or scene has "${id}" in its id.\n`);
    }
    process.stderr.write(
      `Recorded, in ${config.recordingsDir}: ` +
        (recorded.length > 0
          ? `${recorded.join(", ")}.\n`
          : "nothing yet. Run `versioncam record` first.\n"),
    );
    if (config.scenes) {
      process.stderr.write(
        `Scenes, in ${config.scenes}: ${defined.join(", ") || "none"}.\n`,
      );
    }
    return 1;
  }

  if (recordings.length === 0 && scenes.length === 0) {
    process.stderr.write(
      `Nothing to render. Run \`versioncam record\` first; recordings live in ${config.recordingsDir}.\n`,
    );
    return 1;
  }

  const browser = await launchBrowser();
  const rendered: string[] = [];
  const failures: { id: string; error: Error }[] = [];
  const outputs: { id: string; files: string[] }[] = [];
  let film: string | null = null;

  try {
    for (const id of recordings) {
      try {
        const out = await renderRecording(browser, config, id);
        rendered.push(id);
        outputs.push({ id, files: [out.mp4, out.webm, out.poster, out.sheet] });
        process.stdout.write(
          `  ${id}: ${out.durationFrames} frames at ${out.fps}fps ` +
            `(${(out.durationFrames / out.fps).toFixed(1)}s)\n`,
        );
      } catch (error) {
        failures.push({ id, error: error as Error });
      }
    }
    for (const id of scenes) {
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

  if (values.sequence) {
    // The config's order when it states one, since a sequence is an argument
    // and not an accident of how the directory happens to sort.
    const order = config.sequence ?? rendered;
    const stitched = order.filter((id) => rendered.includes(id));
    let unusable: string[] = [];
    if (stitched.length >= 2) {
      const result = await buildSequence(stitched, config.outputDir, {
        threads: config.encoderThreads,
      });
      unusable = result.missing;
      film = result.path;
      process.stdout.write(
        `  sequence: ${result.used.length} clips, ${result.total.toFixed(1)}s\n`,
      );
    } else {
      process.stderr.write("  sequence needs at least two rendered clips.\n");
    }

    // What the piece was stitched without, as plainly as what it was
    // stitched from: four clips of six look finished. The config's sequence
    // says what belongs in it, and a run can render less than that, or more.
    const absent = [
      ...order.filter((id) => !rendered.includes(id)),
      ...unusable,
    ];
    if (absent.length > 0) {
      process.stdout.write(`  (not rendered: ${absent.join(", ")})\n`);
    }
    const unlisted = rendered.filter((id) => !order.includes(id));
    if (unlisted.length > 0) {
      process.stdout.write(
        `  (not in the config's sequence: ${unlisted.join(", ")})\n`,
      );
    }
  }

  // What was made, and where, for a machine: the Action uploads these files
  // without having to know the config's output directory.
  if (typeof values.report === "string") {
    writeReport(resolve(values.report), {
      recorder: RECORDER_VERSION,
      outputDir: config.outputDir,
      rendered: outputs,
      sequence: film,
      failed: failures.map(({ id, error }) => ({ id, message: error.message })),
    });
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
