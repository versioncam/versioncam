import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { ffmpegPath } from "./ffmpeg";

export type EncodeResult = {
  frames: number;
  mp4: string;
  webm: string;
  poster: string;
};

/**
 * Pipe PNG frames into ffmpeg twice — once for H.264, once for VP9.
 *
 * Two encoders rather than a transcode because both come from the same
 * lossless frames; transcoding the mp4 into a webm would compound artefacts
 * for no saving worth having on a ten-second clip.
 */
function startEncoder(args: string[]): ReturnType<typeof spawn> {
  const child = spawn(ffmpegPath(), args, {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on("error", (error) => {
    throw new Error(
      `ffmpeg could not be started (${error.message}). Install it, or add ` +
        "the optional ffmpeg-static dependency.",
    );
  });
  child.on("close", (code) => {
    if (code !== 0) {
      console.error(stderr.split("\n").slice(-25).join("\n"));
      throw new Error(`ffmpeg exited with ${code}`);
    }
  });
  return child;
}

function mp4Args(fps: number, out: string): string[] {
  return [
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-c:v",
    "png",
    "-i",
    "-",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    // Lets a browser start playing before the whole file has downloaded.
    "-movflags",
    "+faststart",
    out,
  ];
}

function webmArgs(fps: number, out: string): string[] {
  return [
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-c:v",
    "png",
    "-i",
    "-",
    "-an",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-row-mt",
    "1",
    out,
  ];
}

function writeAll(
  stream: NodeJS.WritableStream,
  buffer: Buffer,
): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => {
    // Respect backpressure: ffmpeg is slower than the screenshot loop for the
    // first few seconds and an unbounded queue would hold every frame of the
    // clip in memory at once.
    const ok = stream.write(buffer, (error) =>
      error ? rejectWrite(error) : undefined,
    );
    if (ok) resolveWrite();
    else stream.once("drain", () => resolveWrite());
  });
}

function closeEncoder(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    child.on("close", (code) =>
      code === 0
        ? resolveClose()
        : rejectClose(new Error(`ffmpeg exited ${code}`)),
    );
    child.stdin?.end();
  });
}

export type EncodeOptions = {
  id: string;
  fps: number;
  durationFrames: number;
  /** Frame used for the poster image; defaults to a third of the way in. */
  posterFrame?: number;
  outDir: string;
};

/**
 * Walk the render page frame by frame, screenshotting each one into both
 * encoders. The page is a pure function of the frame number, so this loop can
 * be re-run, interrupted or parallelised without changing its output.
 */
export async function encodeFromPage(
  page: Page,
  options: EncodeOptions,
): Promise<EncodeResult> {
  const outDir = options.outDir;
  mkdirSync(outDir, { recursive: true });

  const mp4 = join(outDir, `${options.id}.mp4`);
  const webm = join(outDir, `${options.id}.webm`);
  const poster = join(outDir, `${options.id}-poster.png`);
  const posterFrame =
    options.posterFrame ?? Math.floor(options.durationFrames / 3);

  const h264 = startEncoder(mp4Args(options.fps, mp4));
  const vp9 = startEncoder(webmArgs(options.fps, webm));

  const stage = page.locator("#stage");
  for (let frame = 0; frame < options.durationFrames; frame += 1) {
    await page.evaluate((n) => window.__render?.setFrame(n), frame);
    const buffer = await stage.screenshot({
      type: "png",
      animations: "disabled",
    });
    if (frame === posterFrame) writeFileSync(poster, buffer);
    await writeAll(h264.stdin as NodeJS.WritableStream, buffer);
    await writeAll(vp9.stdin as NodeJS.WritableStream, buffer);
  }

  await Promise.all([closeEncoder(h264), closeEncoder(vp9)]);

  return { frames: options.durationFrames, mp4, webm, poster };
}

/** A strip of evenly spaced frames, for reviewing a clip in a pull request. */
export async function contactSheet(
  page: Page,
  options: {
    id: string;
    durationFrames: number;
    count?: number;
    outDir: string;
  },
): Promise<string> {
  const outDir = options.outDir;
  mkdirSync(outDir, { recursive: true });
  const count = options.count ?? 8;
  const tileDir = join(outDir, `${options.id}-sheet`);
  mkdirSync(tileDir, { recursive: true });

  const stage = page.locator("#stage");
  const tiles: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const frame = Math.round((i / (count - 1)) * (options.durationFrames - 1));
    await page.evaluate((n) => window.__render?.setFrame(n), frame);
    const file = join(tileDir, `${String(i).padStart(2, "0")}.png`);
    writeFileSync(file, await stage.screenshot({ type: "png" }));
    tiles.push(file);
  }

  const sheet = join(outDir, `${options.id}-sheet.png`);
  await new Promise<void>((resolveSheet, rejectSheet) => {
    // `tile` composites frames of ONE stream, so the tiles are fed in as a
    // numbered image sequence rather than as N separate inputs.
    const columns = Math.ceil(count / 2);
    const child = spawn(
      ffmpegPath(),
      [
        "-y",
        "-framerate",
        "1",
        "-i",
        join(tileDir, "%02d.png"),
        "-vf",
        `scale=960:-1,tile=${columns}x2`,
        "-frames:v",
        "1",
        sheet,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolveSheet();
      else
        rejectSheet(new Error(`contact sheet failed:\n${stderr.slice(-800)}`));
    });
  });

  return sheet;
}

declare global {
  interface Window {
    __render?: {
      ready: Promise<void>;
      setFrame: (frame: number) => Promise<void>;
      durationFrames: number;
      fps: number;
    };
  }
}
