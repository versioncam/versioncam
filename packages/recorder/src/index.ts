export { defineRecorder, outputSize, resolveConfig } from "./config";
export type {
  AuthConfig,
  Motion,
  Presentation,
  RecorderConfig,
  RenderConfig,
  ResolvedConfig,
  SettleConfig,
} from "./config";

export { clip, runClip } from "./driver/clip";
export type {
  ClipBody,
  ClipDefinition,
  ClipOptions,
  RunClipResult,
} from "./driver/clip";
export type { RecordingSession, SessionOptions } from "./driver/session";
export { createGate } from "./driver/gate";
export type { Gate } from "./driver/gate";
export type { SettleOptions, SettleReport } from "./driver/settle";

export { loop, catmullRomClosed, resampleByArcLength } from "./core/loop";
export type { LoopPlanner, LoopOptions } from "./core/loop";
export { sseBody } from "./core/sse";
export type { SseFixtureEvent } from "./core/sse";
export { MOTION } from "./core/motion-defaults";
export type {
  Caption,
  CameraKey,
  Highlight,
  HighlightStyle,
  PointerAction,
  Rect,
  Timeline,
  Vec2,
} from "./core/timeline";

export type { Scene, Size } from "./scene";

export { loadClips, loadConfig, loadSceneIds, bundleScenes } from "./loader";
export {
  contactSheet,
  renderRecording,
  renderScene,
  withBrowser,
  readTimeline,
} from "./render/render";
export type { RenderOutcome, RenderTarget } from "./render/render";
export { buildSequence } from "./render/sequence";
