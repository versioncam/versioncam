/**
 * The pure helpers, with nothing behind them.
 *
 * The package's main entry reaches for Playwright, esbuild and the filesystem,
 * because recording needs all three. A consumer's unit test does not: checking
 * that a scripted response parses with the app's own reader is a jsdom test
 * that wants a function and no browser at all. Importing the main entry there
 * drags a bundler into a jsdom environment, where it does not run.
 *
 *     import { sseBody } from "versioncam/fixtures";
 */
export { sseBody } from "./core/sse.js";
export type { SseFixtureEvent } from "./core/sse.js";
