import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser } from "../../driver/launch.js";
import { RECORDER_VERSION, runClip } from "../../driver/clip.js";
import type { ClipDefinition } from "../../driver/clip.js";
import type { ResolvedConfig } from "../../config.js";
import { loadClips, loadConfig } from "../../loader.js";
import { drivingApp } from "../app.js";
import { ensureFailure } from "../../driver/reports.js";
import {
  FAILURE_JSON,
  FAILURE_PNG,
  type Failure,
} from "../../driver/reports.js";
import { writeReport } from "./publish.js";

/**
 * Record every clip and report which still work.
 *
 * This is the command a CI job runs. It does not render — a demo that no
 * longer matches the app fails while being recorded, at the step that no
 * longer exists, and encoding a video of the wreckage helps nobody.
 */
export async function check(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { report: { type: "string" } },
    strict: false,
    allowPositionals: true,
  });
  const reportPath =
    typeof values.report === "string" ? resolve(values.report) : null;

  const config = await loadConfig(process.cwd());
  const clips = await loadClips(config, positionals as string[]);

  if (clips.length === 0) {
    process.stderr.write("No clips to check.\n");
    return 1;
  }

  return drivingApp(config, () => checkAll(config, clips, reportPath));
}

async function checkAll(
  config: ResolvedConfig,
  clips: ClipDefinition[],
  reportPath: string | null,
): Promise<number> {
  const browser = await launchBrowser();
  const failures: { id: string; error: Error }[] = [];

  try {
    for (const clip of clips) {
      try {
        await runClip(browser, config, clip);
        process.stdout.write(`PASS  ${clip.id}\n`);
      } catch (error) {
        failures.push({ id: clip.id, error: error as Error });
        ensureFailure(join(config.recordingsDir, clip.id), error as Error);
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
  if (reportPath) {
    writeReport(reportPath, checkReport(config, clips, failures));
  }
  return failures.length > 0 ? 1 : 0;
}

/**
 * What `--report` writes: each clip's result, the step a failure stopped at,
 * and where its picture is, for a machine to read. The Action builds its pull
 * request comment from this, so it never has to parse what `check` prints or
 * guess where the recordings directory is.
 */
function checkReport(
  config: ResolvedConfig,
  clips: ClipDefinition[],
  failures: { id: string; error: Error }[],
): unknown {
  return {
    recorder: RECORDER_VERSION,
    clips: clips.map((clip) => {
      const failed = failures.find((f) => f.id === clip.id);
      if (!failed) return { id: clip.id, status: "pass" };
      const dir = join(config.recordingsDir, clip.id);
      const written = join(dir, FAILURE_JSON);
      const failure = existsSync(written)
        ? (JSON.parse(readFileSync(written, "utf8")) as Failure)
        : null;
      const picture = join(dir, FAILURE_PNG);
      return {
        id: clip.id,
        status: "fail",
        message: failed.error.message,
        step: failure?.step ?? null,
        t: failure?.t ?? null,
        picture: existsSync(picture) ? picture : null,
      };
    }),
  };
}
