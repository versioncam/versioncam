import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Finds ffmpeg and ffprobe.
 *
 * A system install is preferred: it is what a developer already has, and it
 * is the one whose version they can see. `ffmpeg-static` is an optional
 * dependency for CI images that have neither — optional because downloading a
 * ~70 MB binary during `npm install` is rude in someone else's repository.
 */

let cachedFfmpeg: string | null = null;
let cachedFfprobe: string | null = null;

function onPath(binary: string): boolean {
  const probe = spawnSync(binary, ["-version"], { stdio: "ignore" });
  return probe.status === 0;
}

function fromStaticPackage(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require("ffmpeg-static") as string | { default?: string };
    return typeof resolved === "string" ? resolved : (resolved.default ?? null);
  } catch {
    return null;
  }
}

export function ffmpegPath(): string {
  if (cachedFfmpeg) return cachedFfmpeg;
  if (onPath("ffmpeg")) return (cachedFfmpeg = "ffmpeg");
  const fallback = fromStaticPackage();
  if (fallback) return (cachedFfmpeg = fallback);
  throw new Error(
    "ffmpeg not found. Install it (`brew install ffmpeg`, `apt install ffmpeg`) " +
      "or add the optional ffmpeg-static dependency.",
  );
}

/**
 * ffprobe, which `ffmpeg-static` does not ship — it is a separate package.
 * Only the system one is looked for; without it, duration checks are
 * unavailable rather than wrong.
 */
export function ffprobePath(): string {
  if (cachedFfprobe) return cachedFfprobe;
  if (onPath("ffprobe")) return (cachedFfprobe = "ffprobe");
  throw new Error(
    "ffprobe not found. It usually installs alongside ffmpeg; on a minimal " +
      "image install the full ffmpeg package rather than ffmpeg-static.",
  );
}

export function ffprobeSync(args: string[]): string {
  return execFileSync(ffprobePath(), args, { encoding: "utf8" });
}

/** For `versioncam doctor`: report rather than throw. */
export function ffmpegStatus(): {
  ffmpeg: string | null;
  ffprobe: string | null;
} {
  let ffmpeg: string | null = null;
  let ffprobe: string | null = null;
  try {
    ffmpeg = ffmpegPath();
  } catch {
    ffmpeg = null;
  }
  try {
    ffprobe = ffprobePath();
  } catch {
    ffprobe = null;
  }
  return { ffmpeg, ffprobe };
}
