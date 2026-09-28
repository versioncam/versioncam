import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { ffmpegStatus } from "../../render/ffmpeg.js";
import { ensureApp, probe } from "../../app-server.js";
import type { ResolvedConfig } from "../../config.js";
import { NO_CONFIG, findConfigFile, loadConfig } from "../../loader.js";

type Check = { name: string; ok: boolean; detail: string; fix?: string };

const NOT_SERVING =
  "Start the app, point `baseUrl` at where it is served, or add `webServer` to the config.";

/**
 * Is the app the config points at serving — and if not, can it be started?
 *
 * Not a property of the machine, unlike every other check here, but it is the
 * next thing that stops a recording and the cheapest one to find out about.
 * An authoring loop asks this before it writes a clip; without it the first
 * sign of a stopped dev server is a clip failing on a locator.
 *
 * With a `webServer`, this is also the rehearsal for every other command: it
 * starts the app exactly the way `record` would, reports how long that took,
 * and stops it again, so a repository finds out its start command is wrong
 * here rather than halfway into a clip. Without one, any HTTP answer at all
 * counts as up, including a 401 or a redirect — an app behind a sign-in
 * answers that way and records perfectly well.
 */
async function appCheck(cwd: string): Promise<Check> {
  let config: ResolvedConfig;
  try {
    config = await loadConfig(cwd);
  } catch (error) {
    return {
      name: "app",
      ok: false,
      detail: `config did not load: ${(error as Error).message}`,
      fix: "Fix versioncam.config.ts; every other command loads it too.",
    };
  }

  if (!config.webServer) {
    const answer = await probe(config.baseUrl);
    return answer.up
      ? {
          name: "app",
          ok: true,
          detail: `already serving at ${config.baseUrl} — HTTP ${answer.status}`,
        }
      : {
          name: "app",
          ok: false,
          detail: `${config.baseUrl} — ${answer.reason}`,
          fix: NOT_SERVING,
        };
  }

  try {
    const app = await ensureApp(config);
    await app.stop();
    return {
      name: "app",
      ok: true,
      detail: app.started ? `${app.detail} (stopped again)` : app.detail,
    };
  } catch (error) {
    // The first line says what went wrong; the rest is the server's own
    // output, which is usually where the reason is.
    const [first, ...rest] = (error as Error).message.split("\n");
    return { name: "app", ok: false, detail: first, fix: rest.join("\n") };
  }
}

/**
 * Can this machine record and encode?
 *
 * Reports every check rather than stopping at the first failure, because the
 * usual case on a new machine is that two or three things are missing at once
 * and being told about them one run at a time is tedious.
 */
export async function doctor(): Promise<number> {
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: major >= 22,
    detail: `v${process.versions.node}`,
    fix: "Install Node 22 or newer.",
  });

  let chromiumPath = "";
  try {
    chromiumPath = chromium.executablePath();
  } catch {
    chromiumPath = "";
  }
  checks.push({
    name: "chromium",
    ok: chromiumPath !== "" && existsSync(chromiumPath),
    detail: chromiumPath || "not installed",
    fix: "npx versioncam install",
  });

  const { ffmpeg, ffprobe } = ffmpegStatus();
  checks.push({
    name: "ffmpeg",
    ok: ffmpeg !== null,
    detail: ffmpeg ?? "not found",
    fix: "brew install ffmpeg  (or apt install ffmpeg)",
  });
  checks.push({
    name: "ffprobe",
    ok: ffprobe !== null,
    detail: ffprobe ?? "not found",
    fix: "Installs with ffmpeg; ffmpeg-static does not include it.",
  });

  const config = findConfigFile(process.cwd());
  checks.push({
    name: "config",
    ok: config !== null,
    detail: config ?? `no versioncam.config.ts in ${process.cwd()}`,
    fix: NO_CONFIG,
  });

  // Only with a config: without one there is no `baseUrl` to try, and saying
  // so twice would be noise.
  if (config !== null) checks.push(await appCheck(process.cwd()));

  for (const check of checks) {
    process.stdout.write(
      `${check.ok ? "✓" : "✗"} ${check.name.padEnd(9)} ${check.detail}\n`,
    );
    if (!check.ok && check.fix) {
      for (const line of check.fix.split("\n")) {
        process.stdout.write(`            ${line}\n`);
      }
    }
  }

  const failed = checks.filter((c) => !c.ok);
  return failed.length === 0 ? 0 : 1;
}
