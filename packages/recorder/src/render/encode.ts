import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { ffmpegPath } from "./ffmpeg.js";
import { uniformFrames } from "./sampling.js";

export type EncodeResult = {
  frames: number;
  mp4: string;
  webm: string;
  poster: string;
};

/**
 * One ffmpeg, fed frames on its stdin, and how it ended.
 *
 * `done` settles when ffmpeg exits: resolved on success, rejected with the
 * tail of what it printed otherwise. It is the only way an encoder reports
 * failure. The handlers it replaced threw from inside event callbacks, where
 * no caller could catch them, so stopping an encoder on purpose would have
 * taken the whole process down.
 */
type Encoder = { child: ChildProcess; done: Promise<void> };

/**
 * Pipe PNG frames into ffmpeg twice: once for H.264, once for VP9.
 *
 * Two encoders rather than a transcode because both come from the same
 * lossless frames; transcoding the mp4 into a webm would compound artefacts
 * for no saving worth having on a ten-second clip.
 */
function startEncoder(args: string[], what: string): Encoder {
  const child = spawn(ffmpegPath(), args, {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // A write to an encoder that has exited fails with EPIPE. The write's own
  // callback and `done` both report it; left unhandled here, it would crash.
  child.stdin?.on("error", () => {});
  const done = new Promise<void>((resolveDone, rejectDone) => {
    child.once("error", (error) =>
      rejectDone(
        new Error(
          `ffmpeg could not be started (${error.message}). Install it, or add ` +
            "the optional ffmpeg-static dependency.",
        ),
      ),
    );
    child.once("close", (code, signal) => {
      if (code === 0) return resolveDone();
      const how = signal ? `was stopped (${signal})` : `exited with ${code}`;
      const tail = stderr.split("\n").slice(-25).join("\n");
      rejectDone(new Error(`ffmpeg (${what}) ${how}:\n${tail}`));
    });
  });
  // Whoever finishes the encode awaits `done`. A render stopped early only
  // waits for it to settle, and must not leave it an unhandled rejection.
  done.catch(() => {});
  return { child, done };
}

/**
 * Where `name.ext` is written until it is whole: `name.partial.ext`, the
 * sequence's convention. ffmpeg picks its muxer from the extension, so the
 * extension stays last.
 */
function partial(file: string): string {
  return file.replace(/(\.[^./]+)$/, ".partial$1");
}

/**
 * `-threads` as an output option, placed just before the output file: the
 * same flag before `-i` would set the decoder's threads instead, which change
 * nothing about the bytes written.
 */
export function threadArgs(threads: number | null | undefined): string[] {
  return threads ? ["-threads", String(threads)] : [];
}

/**
 * Output options that make a file's bytes depend only on its frames. Without
 * `bitexact` the WebM muxer writes a random segment id into every file, so no
 * two renders of one recording were ever the same bytes, and both muxers
 * stamp the file with the ffmpeg build that wrote it.
 */
export const REPRODUCIBLE: readonly string[] = ["-fflags", "+bitexact"];

function mp4Args(fps: number, out: string, threads?: number | null): string[] {
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
    ...REPRODUCIBLE,
    ...threadArgs(threads),
    out,
  ];
}

function webmArgs(fps: number, out: string, threads?: number | null): string[] {
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
    ...REPRODUCIBLE,
    ...threadArgs(threads),
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

/**
 * One frame into one encoder. An encoder that exits early fails the write
 * with ffmpeg's own account of why, rather than leaving it waiting on a
 * `drain` that will never come.
 */
function feed(encoder: Encoder, buffer: Buffer): Promise<void> {
  return Promise.race([
    writeAll(encoder.child.stdin as NodeJS.WritableStream, buffer),
    encoder.done.then(() => {
      throw new Error("ffmpeg finished before the last frame was sent");
    }),
  ]);
}

export type EncodeOptions = {
  id: string;
  fps: number;
  durationFrames: number;
  /** Frame used for the poster image; defaults to a third of the way in. */
  posterFrame?: number;
  outDir: string;
  /** Threads per encoder; null or absent leaves it to ffmpeg. */
  threads?: number | null;
};

/**
 * Walk the render page frame by frame, screenshotting each one into both
 * encoders. The page is a pure function of the frame number, so this loop can
 * be re-run, interrupted or parallelised without changing its output.
 *
 * Nothing the last good render left is touched until this one has finished.
 * The clip, its webm and its poster are written beside them, as
 * `.partial` files, and moved over them only once both encoders have
 * exited cleanly. Written in place, a scene that threw at frame 30 of 60
 * left a playable half-clip, and the failed run's poster, where the last
 * good render had been.
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
  const outputs = [mp4, webm, poster];

  const encoders = [
    startEncoder(mp4Args(options.fps, partial(mp4), options.threads), "H.264"),
    startEncoder(webmArgs(options.fps, partial(webm), options.threads), "VP9"),
  ];

  try {
    const stage = page.locator("#stage");
    for (let frame = 0; frame < options.durationFrames; frame += 1) {
      await page.evaluate((n) => window.__render?.setFrame(n), frame);
      const buffer = await stage.screenshot({
        type: "png",
        animations: "disabled",
      });
      if (frame === posterFrame) writeFileSync(partial(poster), buffer);
      for (const encoder of encoders) await feed(encoder, buffer);
    }
    for (const encoder of encoders) encoder.child.stdin?.end();
    await Promise.all(encoders.map((encoder) => encoder.done));
  } catch (error) {
    // Both encoders are waiting for frames that will never come. Left
    // running, they held the process open after the error was reported:
    // `render` said what had failed and then never exited, which in CI is a
    // job that hangs until it is killed.
    for (const encoder of encoders) {
      encoder.child.stdin?.destroy();
      encoder.child.kill("SIGKILL");
    }
    await Promise.allSettled(encoders.map((encoder) => encoder.done));
    for (const file of outputs) rmSync(partial(file), { force: true });
    throw error;
  }

  for (const file of outputs) {
    // No poster when the poster frame is past the end: the last one stays.
    if (existsSync(partial(file))) renameSync(partial(file), file);
  }
  return { frames: options.durationFrames, mp4, webm, poster };
}

/** A strip of frames, for reviewing a clip in a pull request. */
export async function contactSheet(
  page: Page,
  options: {
    id: string;
    durationFrames: number;
    count?: number;
    /**
     * Exactly which frames to show. Evenly spaced when absent, which suits a
     * scene; a recording's come from `evenFrames`, which knows where its
     * dissolves are.
     */
    frames?: number[];
    outDir: string;
  },
): Promise<string> {
  const outDir = options.outDir;
  mkdirSync(outDir, { recursive: true });
  const frames =
    options.frames ?? uniformFrames(options.durationFrames, options.count);
  const tileDir = join(outDir, `${options.id}-sheet`);
  mkdirSync(tileDir, { recursive: true });

  const stage = page.locator("#stage");
  const tiles: string[] = [];
  for (const [index, frame] of frames.entries()) {
    await page.evaluate((n) => window.__render?.setFrame(n), frame);
    const file = join(tileDir, `${String(index).padStart(2, "0")}.png`);
    writeFileSync(file, await stage.screenshot({ type: "png" }));
    tiles.push(file);
  }

  const sheet = join(outDir, `${options.id}-sheet.png`);
  await new Promise<void>((resolveSheet, rejectSheet) => {
    // `tile` composites frames of ONE stream, so the tiles are fed in as a
    // numbered image sequence rather than as N separate inputs.
    // Two rows once there are enough tiles to fill them, one row before that.
    // `tile` pads a grid it cannot fill, so three frames in a 2x2 gave a fourth
    // cell holding a repeat of the third — a tile a reviewer has to work out is
    // not evidence, which is exactly the work a contact sheet exists to save.
    const rows = frames.length > 4 ? 2 : 1;
    const columns = Math.ceil(frames.length / rows);
    const child = spawn(
      ffmpegPath(),
      [
        "-y",
        "-framerate",
        "1",
        "-i",
        join(tileDir, "%02d.png"),
        "-vf",
        `scale=960:-1,tile=${columns}x${rows}`,
        "-frames:v",
        "1",
        partial(sheet),
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.once("error", (error) =>
      rejectSheet(new Error(`ffmpeg could not be started (${error.message})`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolveSheet();
      else
        rejectSheet(new Error(`contact sheet failed:\n${stderr.slice(-800)}`));
    });
  }).catch((error: unknown) => {
    rmSync(partial(sheet), { force: true });
    throw error;
  });

  // Like the clip: the last good sheet stays until this one is whole.
  renameSync(partial(sheet), sheet);
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
