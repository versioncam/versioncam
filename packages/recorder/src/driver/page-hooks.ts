/**
 * Scripts injected into every document the recorder drives.
 *
 * These run at document start, before any app code, and must be
 * self-contained strings — they are evaluated in the page, not here.
 */

/**
 * Counts DOM mutations so `settle()` can tell "the page is still working"
 * from "the page has finished". Counting is far cheaper than diffing and
 * needs no cooperation from the app.
 */
export const MUTATION_COUNTER_SCRIPT = `(() => {
  const state = { mutations: 0 };
  window.__recorder = state;
  const start = () => {
    const target = document.documentElement || document;
    new MutationObserver((records) => {
      state.mutations += records.length;
    }).observe(target, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();`;

/**
 * Puts the page's CSS motion under the recorder's control.
 *
 * `page.clock` drives timers and requestAnimationFrame, but CSS transitions
 * and animations run on the compositor's own clock, which the fake clock does
 * not touch. Left alone they produce half-finished frames whose content
 * depends on how busy the machine was — the exact non-determinism this
 * recorder exists to remove.
 *
 * Transitions are simply zeroed: a state change should land in the frame that
 * caused it, and the renderer puts a uniform crossfade back in post.
 *
 * Animations are handled differently, because zeroing them is wrong. A
 * loading spinner with `animation-duration: 0s` is a dead spinner, and a clip
 * that pauses on a dead spinner looks broken rather than thoughtful. So every
 * animation is *paused* and then scrubbed to a chosen offset by a negative
 * delay: a paused animation renders the state it would have been in at
 * `-animation-delay`. The driver sets that offset from authored time, once per
 * frame, which makes the page's own animations advance with the clip —
 * deterministically, at exactly the rate the timeline says.
 *
 * `scroll-behavior: auto` is here for the same reason: a smooth-scrolling
 * container animates outside our control.
 */
export const FREEZE_CSS = `*, *::before, *::after {
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  animation-play-state: paused !important;
  animation-delay: calc(-1s * var(--recorder-t, 0)) !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}`;

export const FREEZE_CSS_SCRIPT = `(() => {
  const css = ${JSON.stringify(FREEZE_CSS)};
  const inject = () => {
    const style = document.createElement("style");
    style.id = "__recorder_freeze";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.head || document.documentElement) inject();
  else document.addEventListener("DOMContentLoaded", inject, { once: true });
})();`;

/**
 * Advance the page's CSS animations to `seconds` of authored time. Called once
 * per captured frame; a plain custom-property write, so it costs one round
 * trip and no layout.
 */
export const SET_ANIMATION_TIME = (seconds: number): string =>
  `document.documentElement.style.setProperty("--recorder-t", "${seconds.toFixed(4)}")`;

declare global {
  interface Window {
    __recorder?: { mutations: number };
  }
}
