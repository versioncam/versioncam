import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../config.js";
import { renderConfigOf } from "../config.js";
import type { Timeline } from "../core/timeline.js";
import {
  FAILURE_JSON,
  FAILURE_PNG,
  TARGETS_FILE,
  type Failure,
} from "../driver/reports.js";
import {
  contentOfTimeline,
  type CheckResult,
  type ClipManifest,
  type PublishedRenderConfig,
  type RecordingManifest,
  type StateRef,
} from "./protocol.js";

/**
 * A recording directory, read into what a publish says about it.
 *
 * Everything the service is told is computed here from the files, never from
 * the run that made them, so `publish` can run in a later CI step (or a later
 * job) than the recording did and say exactly the same thing.
 */

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A PNG's size from its header. The signature is eight bytes and the first
 * chunk is always IHDR, whose data starts with the width and height as
 * big-endian 32-bit integers, so no decoder is needed to tell the service
 * what it is about to receive.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = "89504e470d0a1a0a";
  if (view.length < 24 || view.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("not a PNG");
  }
  if (view.subarray(12, 16).toString("latin1") !== "IHDR") {
    throw new Error("a PNG whose first chunk is not IHDR");
  }
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

/** What the service renders with: the render page's config, and its clock. */
export function publishedRenderConfig(
  config: ResolvedConfig,
): PublishedRenderConfig {
  const { scenes: _scenes, ...render } = renderConfigOf(config);
  return {
    ...render,
    clock: {
      timezoneId: config.clock.timezoneId,
      locale: config.clock.locale,
    },
  };
}

/** The files a recording's manifest was computed from, to upload on request. */
export type RecordingFiles = {
  timeline: Uint8Array;
  targets: Uint8Array | null;
  /** By hash, for the states the service asks for. */
  states: Map<string, string>;
  failure: Uint8Array | null;
};

/**
 * One clip's manifest, from its recording directory.
 *
 * A directory holding `failure.json` failed its last run: the recorder
 * clears a clip's directory before recording it, so a failure there is the
 * latest word on the clip, and what it recorded before failing is not a
 * recording anyone should see. Otherwise `timeline.json` is a complete
 * recording that passed. With neither, the clip was never recorded here.
 */
export function readClip(
  dir: string,
  clip: { id: string; title: string },
  renderConfig: PublishedRenderConfig,
): { manifest: ClipManifest; files: RecordingFiles } | null {
  const failureJson = join(dir, FAILURE_JSON);
  const timelineFile = join(dir, "timeline.json");

  if (existsSync(failureJson)) {
    const failure = JSON.parse(readFileSync(failureJson, "utf8")) as Failure;
    const png = join(dir, FAILURE_PNG);
    const picture = existsSync(png) ? readFileSync(png) : null;
    const check: CheckResult = {
      status: "fail",
      message: failure.message,
      step: failure.step ?? null,
      frame: failure.frame,
      t: failure.t,
    };
    return {
      manifest: {
        id: clip.id,
        title: clip.title,
        check,
        recording: null,
        failureHash: picture ? sha256Hex(picture) : null,
      },
      files: {
        timeline: new Uint8Array(),
        targets: null,
        states: new Map(),
        failure: picture,
      },
    };
  }

  if (!existsSync(timelineFile)) return null;

  const timelineBytes = readFileSync(timelineFile);
  const timeline = JSON.parse(timelineBytes.toString("utf8")) as Timeline;
  const targetsFile = join(dir, TARGETS_FILE);
  const targets = existsSync(targetsFile) ? readFileSync(targetsFile) : null;

  const statePaths = new Map<string, string>();
  const states: StateRef[] = timeline.states.map((name) => {
    const path = join(dir, "states", name);
    const bytes = readFileSync(path);
    const hash = sha256Hex(bytes);
    statePaths.set(hash, path);
    return { hash, bytes: bytes.length, ...pngSize(bytes) };
  });

  const targetsHash = targets ? sha256Hex(targets) : null;
  const contentHash = sha256Hex(
    Buffer.from(
      JSON.stringify({
        timeline: contentOfTimeline(timeline),
        states: states.map((s) => s.hash),
        targets: targetsHash,
        renderConfig,
      }),
    ),
  );

  const recording: RecordingManifest = {
    contentHash,
    timelineHash: sha256Hex(timelineBytes),
    timelineBytes: timelineBytes.length,
    targetsHash,
    draft: timeline.meta.draft === true,
    fps: timeline.fps,
    durationFrames: timeline.durationFrames,
    viewport: timeline.viewport,
    states,
    renderConfig,
  };

  return {
    manifest: {
      id: clip.id,
      title: clip.title || timeline.meta.title,
      check: { status: "pass" },
      recording,
      failureHash: null,
    },
    files: {
      timeline: timelineBytes,
      targets,
      states: statePaths,
      failure: null,
    },
  };
}
