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
  const state = {
    mutations: 0,
    ids: new WeakMap(),
    nextId: 1,
    idOf(el) {
      if (!el) return 0;
      let id = state.ids.get(el);
      if (!id) { id = state.nextId++; state.ids.set(el, id); }
      return id;
    },
    probe(t, x, y) {
      document.documentElement.style.setProperty("--recorder-t", t);
      return {
        mutations: state.mutations,
        hovered: state.idOf(document.elementFromPoint(x, y)),
        animations: document.getAnimations().length,
      };
    },
  };
  window.__recorder = state;

  // The driver writes --recorder-t to <html style> on every single frame. Left
  // alone that write is a mutation like any other, so the counter would move
  // every frame and anything built on it — a settle that waits for quiet, a
  // gate that skips an unchanged frame — would be reading its own footprint.
  // Anything else that touches <html style>, a scroll lock or a theme switch,
  // still counts.
  const withoutScrub = (value) =>
    (value || "").replace(/--recorder-t\\s*:[^;]*;?/g, "").trim();

  const start = () => {
    const root = document.documentElement;
    const isOurScrub = (record) =>
      record.type === "attributes" &&
      record.target === root &&
      record.attributeName === "style" &&
      withoutScrub(record.oldValue) === withoutScrub(root.getAttribute("style"));

    new MutationObserver((records) => {
      for (const record of records) {
        if (!isOurScrub(record)) state.mutations += 1;
      }
    }).observe(root || document, {
      childList: true,
      attributes: true,
      attributeOldValue: true,
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
 * What the driver learns from the page once per frame.
 *
 * One round trip does three jobs: it advances the page's CSS animations to
 * this frame's authored time, and reports the two things that decide whether
 * this frame needs a screenshot.
 *
 * `hovered` is the identity of the element under the cursor, as a number. The
 * cursor glyph is drawn in post, so the pointer moving changes no pixel by
 * itself — what changes pixels is the pointer moving *onto something else*.
 * `elementFromPoint` runs the same hit test a real pointer event does, so when
 * it returns the same element as last frame, the `:hover` chain is the same
 * chain and no hover styling can have changed.
 *
 * `animations` is how many animations are running. A scrubbed animation
 * repaints on every frame without touching the DOM, so while any is on screen
 * — a spinner, a progress bar — every frame is genuinely different and none
 * may be skipped.
 */
export const FRAME_PROBE = (seconds: number, x: number, y: number): string =>
  `window.__recorder.probe("${seconds.toFixed(4)}", ${x.toFixed(2)}, ${y.toFixed(2)})`;

export type FrameProbe = {
  mutations: number;
  /** Identity of the element under the cursor; 0 when there is none. */
  hovered: number;
  animations: number;
};

declare global {
  interface Window {
    __recorder?: {
      mutations: number;
      probe(t: string, x: number, y: number): FrameProbe;
    };
  }
}
