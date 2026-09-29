/**
 * `versioncam/publish`: what the version.cam service imports.
 *
 * Nothing reachable from here may import Node, Playwright or ffmpeg: the
 * service runs on Cloudflare Workers, and one stray import of the driver
 * would pull a browser into its bundle. The recorder's own publish code
 * (manifests, the client) lives beside this file and is not re-exported.
 */
export * from "./protocol.js";
export { validateTimeline } from "../core/timeline.js";
export type { Timeline, Step, Rect, Mark, Caption } from "../core/timeline.js";
export type { Motion, Presentation } from "../config.js";
