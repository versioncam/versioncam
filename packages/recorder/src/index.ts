export { defineRecorder, outputSize, resolveConfig } from "./config.js";
export type {
  AuthConfig,
  CaptionInset,
  CaptureConfig,
  CursorStart,
  ReviewConfig,
  Motion,
  Presentation,
  RecorderConfig,
  RenderConfig,
  ResolvedConfig,
  ResolvedWebServer,
  SettleConfig,
  WebServerConfig,
} from "./config.js";
export { ensureApp, withApp } from "./app-server.js";
export type { AppHandle } from "./app-server.js";

export { clip, runClip } from "./driver/clip.js";
export type { RunClipOptions } from "./driver/clip.js";
export type {
  ClipBody,
  ClipDefinition,
  ClipOptions,
  RunClipResult,
} from "./driver/clip.js";
export type { RecordingSession, SessionOptions } from "./driver/session.js";
export { createGate } from "./driver/gate.js";
export type { Gate } from "./driver/gate.js";
export type { SettleOptions, SettleReport } from "./driver/settle.js";
export { launchBrowser, DETERMINISTIC_ARGS } from "./driver/launch.js";
export { formatTiming } from "./core/timing.js";
export type { RecordingTiming } from "./core/timing.js";

export { loop, catmullRomClosed, resampleByArcLength } from "./core/loop.js";
export type { LoopPlanner, LoopOptions } from "./core/loop.js";
export { sseBody } from "./core/sse.js";
export type { SseFixtureEvent } from "./core/sse.js";
export { MOTION } from "./core/motion-defaults.js";
export type {
  Caption,
  CameraKey,
  Highlight,
  HighlightStyle,
  Mark,
  PointerAction,
  Rect,
  Timeline,
  Vec2,
} from "./core/timeline.js";

export type { Scene, Size } from "./scene.js";

export { loadClips, loadConfig, loadSceneIds, bundleScenes } from "./loader.js";
export {
  contactSheet,
  renderFrame,
  renderRecording,
  renderScene,
  withBrowser,
  readTimeline,
} from "./render/render.js";
export type { RenderOutcome, RenderTarget } from "./render/render.js";
export {
  beatFrame,
  evenFrames,
  frameAtMark,
  markedFrames,
  uniformFrames,
  SHEET_TILES,
} from "./render/sampling.js";
export {
  compareRecordings,
  frameHashes,
  readRecording,
  stateFileAt,
} from "./driver/compare.js";
export type { Comparison, RecordingRef } from "./driver/compare.js";
export {
  formatReview,
  reviewRecording,
  DEFAULT_BOUNDS,
} from "./review/review.js";
export type {
  Beat,
  ReviewBounds,
  ReviewInput,
  ReviewItem,
  ReviewResult,
} from "./review/review.js";
export { buildSequence } from "./render/sequence.js";
