import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "../../driver/launch.js";
import { loadConfig } from "../../loader.js";
import { renderConfigOf } from "../../config.js";
import { bundleScenes } from "../../loader.js";
import {
  distPageDir,
  installRenderRoutes,
  RENDER_ORIGIN,
} from "../../render/serve.js";

/**
 * Open the scrubber, in a browser a person can see.
 *
 * Tuning a clip's easing and framing is done by eye, frame by frame, and this
 * is the only way to do it — against exactly the code path the encoder uses,
 * so what is tuned is what ships.
 */
export async function preview(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { scene: { type: "string" }, frame: { type: "string" } },
    strict: false,
    allowPositionals: true,
  });

  const config = await loadConfig(process.cwd());
  const sceneId = values.scene as string | undefined;
  const id = sceneId ?? (positionals[0] as string | undefined);
  if (!id) {
    process.stderr.write("Usage: versioncam preview <id> | --scene <id>\n");
    return 1;
  }

  const dir = join(config.recordingsDir, id);
  if (!sceneId && !existsSync(join(dir, "timeline.json"))) {
    process.stderr.write(`No recording for "${id}".\n`);
    return 1;
  }

  const browser = await launchBrowser({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await installRenderRoutes(page, {
    distDir: distPageDir(),
    renderConfig: renderConfigOf(config),
    recordingDir: sceneId ? undefined : dir,
    scenesBundle: (await bundleScenes(config)) ?? undefined,
  });

  const query = sceneId ? `scene=${encodeURIComponent(sceneId)}` : "recording";
  const frame = values.frame ? `&frame=${values.frame}` : "";
  await page.goto(`${RENDER_ORIGIN}/?${query}${frame}`);

  process.stdout.write("Scrubber open. Close the window to finish.\n");
  await page.waitForEvent("close", { timeout: 0 });
  await browser.close();
  return 0;
}
