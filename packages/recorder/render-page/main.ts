import { drawRecordingFrame } from "./draw";
import type { Frames } from "./draw";
import type { RenderConfig } from "../src/config";
import type { Scene } from "../src/scene";
import type { Timeline } from "../src/core/timeline";

/**
 * The render page.
 *
 * Two jobs, one code path: a scrubber for tuning motion by eye, and a
 * `window.__render.setFrame(n)` the encoder drives headlessly. They must be
 * the same path — a preview that renders differently from the export is worse
 * than no preview.
 *
 * Everything it needs arrives over routes the renderer installs, not from a
 * web server: the recording, the config, and the app's scene bundle if it has
 * one. Rendering therefore needs nothing running except this page.
 */

type RenderApi = {
  ready: Promise<void>;
  setFrame: (frame: number) => Promise<void>;
  durationFrames: number;
  fps: number;
};

declare global {
  interface Window {
    __render?: RenderApi;
  }
}

const params = new URLSearchParams(location.search);
const wantsRecording = params.has("recording");
const sceneId = params.get("scene");
const headless = params.get("headless") === "1";
if (headless) document.body.classList.add("headless");

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const scrub = document.getElementById("scrub") as HTMLInputElement;
const status = document.getElementById("status") as HTMLElement;
const playButton = document.getElementById("play") as HTMLButtonElement;
const errorBox = document.getElementById("error") as HTMLElement;

function fail(message: string): never {
  errorBox.textContent = message;
  throw new Error(message);
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) fail(`Could not load ${what} (${url}): ${response.status}`);
  return (await response.json()) as T;
}

async function loadImage(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) fail(`Could not load ${url}: ${response.status}`);
  return createImageBitmap(await response.blob());
}

function prepareCanvas(config: RenderConfig): CanvasRenderingContext2D {
  canvas.width = config.output.width;
  canvas.height = config.output.height;
  if (headless) {
    canvas.style.width = `${config.output.width}px`;
    canvas.style.height = `${config.output.height}px`;
  } else {
    // Fit the preview to the window without changing what gets drawn.
    canvas.style.width = "min(100%, 1280px)";
    canvas.style.height = "auto";
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) fail("No 2D context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

function wirePlayback(
  fps: number,
  durationFrames: number,
  currentFrame: () => number,
  render: (frame: number) => void,
): void {
  let playing = false;
  playButton.addEventListener("click", () => {
    playing = !playing;
    playButton.textContent = playing ? "Pause" : "Play";
    let last = performance.now();
    const tick = (now: number) => {
      if (!playing) return;
      if (now - last >= 1000 / fps) {
        last = now;
        render((currentFrame() + 1) % durationFrames);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Mutated rather than replaced: the encoder holds a reference from before boot finished. */
function publish(
  api: RenderApi,
  durationFrames: number,
  fps: number,
  render: (frame: number) => void,
): void {
  api.durationFrames = durationFrames;
  api.fps = fps;
  api.setFrame = (frame: number) =>
    new Promise<void>((resolve) => {
      render(frame);
      // Two rAFs: one for the draw to be committed, one for the compositor to
      // have painted it, so the encoder never screenshots a stale canvas.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

async function bootRecording(api: RenderApi, config: RenderConfig) {
  const timeline = await getJson<Timeline>(
    "/recording/timeline.json",
    "the recording",
  );
  const ctx = prepareCanvas(config);

  // Everything the renderer needs must be resident before frame 0: a state
  // image that decodes lazily would make the first frame of a render differ
  // from the same frame later in the run.
  const images = await Promise.all(
    timeline.states.map((name) => loadImage(`/recording/states/${name}`)),
  );
  const frames: Frames = { images };
  await document.fonts.ready;

  let current = -1;
  const render = (frame: number): void => {
    const clamped = Math.max(0, Math.min(timeline.durationFrames - 1, frame));
    drawRecordingFrame(ctx, timeline, frames, clamped, canvas, config);
    current = clamped;
    if (!headless) {
      scrub.value = String(clamped);
      status.textContent = `${clamped + 1} / ${timeline.durationFrames}  ·  ${(
        clamped / timeline.fps
      ).toFixed(2)}s  ·  state ${timeline.frames[clamped]}`;
    }
  };

  scrub.max = String(timeline.durationFrames - 1);
  scrub.addEventListener("input", () => render(Number(scrub.value)));
  wirePlayback(timeline.fps, timeline.durationFrames, () => current, render);
  render(Number(params.get("frame") ?? 0));
  publish(api, timeline.durationFrames, timeline.fps, render);
}

async function bootScene(api: RenderApi, config: RenderConfig, id: string) {
  // Held in a variable so TypeScript does not try to resolve it: the bundle
  // exists only as a route the renderer installs, never as a file on disk.
  const scenesUrl = "/scenes.js";
  const module = (await import(/* @vite-ignore */ scenesUrl)) as {
    default: Record<string, Scene>;
  };
  const scenes = module.default;
  const scene = scenes?.[id];
  if (!scene) {
    fail(
      `No scene "${id}". The scenes module exports: ${Object.keys(scenes ?? {}).join(", ") || "(nothing)"}.`,
    );
  }

  const ctx = prepareCanvas(config);
  await document.fonts.ready;

  let current = -1;
  const render = (frame: number): void => {
    const clamped = Math.max(0, Math.min(scene.durationFrames - 1, frame));
    scene.draw(ctx, clamped, canvas);
    current = clamped;
    if (!headless) {
      scrub.value = String(clamped);
      status.textContent = `${clamped + 1} / ${scene.durationFrames}  ·  ${(
        clamped / scene.fps
      ).toFixed(2)}s`;
    }
  };

  scrub.max = String(scene.durationFrames - 1);
  scrub.addEventListener("input", () => render(Number(scrub.value)));
  wirePlayback(scene.fps, scene.durationFrames, () => current, render);
  render(Number(params.get("frame") ?? 0));
  publish(api, scene.durationFrames, scene.fps, render);
}

async function boot(api: RenderApi): Promise<void> {
  const config = await getJson<RenderConfig>(
    "/render-config.json",
    "the render config",
  );
  if (sceneId) return bootScene(api, config, sceneId);
  if (wantsRecording) return bootRecording(api, config);
  fail("Pass ?recording or ?scene=<id>.");
}

const api: RenderApi = {
  ready: Promise.resolve(),
  setFrame: async () => {},
  durationFrames: 0,
  fps: 60,
};
window.__render = api;
api.ready = boot(api);
