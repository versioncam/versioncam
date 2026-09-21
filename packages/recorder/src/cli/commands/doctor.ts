import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { ffmpegStatus } from "../../render/ffmpeg.js";
import { findConfigFile, loadConfig } from "../../loader.js";

type Check = { name: string; ok: boolean; detail: string; fix?: string };

/**
 * Is the app the config points at actually serving?
 *
 * Not a property of the machine, unlike every other check here, but it is the
 * next thing that stops a recording and the cheapest one to find out about.
 * An authoring loop asks this before it writes a clip; without it the first
 * sign of a stopped dev server is a clip failing on a locator.
 *
 * Any answer at all counts as reachable, including a 401 or a redirect: an app
 * behind a login answers that way and records perfectly well. Five seconds is
 * a limit on a local server that is up, not on a cold remote deployment.
 */
async function appReachable(cwd: string): Promise<Check> {
  let baseUrl: string;
  try {
    baseUrl = (await loadConfig(cwd)).baseUrl;
  } catch (error) {
    return {
      name: "app",
      ok: false,
      detail: `config did not load: ${(error as Error).message}`,
      fix: "Fix recorder.config.ts; every other command loads it too.",
    };
  }

  try {
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(5_000),
      redirect: "manual",
    });
    return {
      name: "app",
      ok: true,
      detail: `${baseUrl} — HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: "app",
      ok: false,
      detail: `${baseUrl} — ${(error as Error).message}`,
      fix: "Start the app, or point `baseUrl` at where it is being served.",
    };
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
    fix: "npx playwright install chromium",
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
    detail: config ?? `no recorder.config.ts in ${process.cwd()}`,
    fix: "Create recorder.config.ts with a default export from defineRecorder().",
  });

  // Only with a config: without one there is no `baseUrl` to try, and saying
  // so twice would be noise.
  if (config !== null) checks.push(await appReachable(process.cwd()));

  for (const check of checks) {
    process.stdout.write(
      `${check.ok ? "✓" : "✗"} ${check.name.padEnd(9)} ${check.detail}\n`,
    );
    if (!check.ok && check.fix)
      process.stdout.write(`            ${check.fix}\n`);
  }

  const failed = checks.filter((c) => !c.ok);
  return failed.length === 0 ? 0 : 1;
}
