import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { ffmpegStatus } from "../../render/ffmpeg.js";
import { findConfigFile } from "../../loader.js";

type Check = { name: string; ok: boolean; detail: string; fix?: string };

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
