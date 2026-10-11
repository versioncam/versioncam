/**
 * Scripts injected into every document the recorder drives.
 *
 * These run at document start, before any app code, and must be
 * self-contained strings — they are evaluated in the page, not here.
 */

import type { Transitions } from "../config.js";

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
    // A CSS animation is paused and scrubbed to authored time (freezeCss), and
    // a paused animation never finishes by itself: its \`finished\` promise
    // never resolves. Components that unmount once their exit animation has
    // finished, Base UI's dialogs, popovers, menus and tooltips among them,
    // waited on it for ever, and a closed dialog's backdrop, scrubbed to
    // opacity 0, stayed over the page and took the next click (0.5.0). So a
    // finite animation whose time is up is finished, as it would be in a
    // browser nobody is filming; one still under way keeps its scrub, and
    // one that repeats for ever never reaches an end. Transitions have their
    // clock (TRANSITION_CLOCK_SCRIPT), and animations a script made with
    // \`element.animate()\` are the app's own.
    finishEnded() {
      let finished = 0;
      for (const animation of document.getAnimations()) {
        if (!("animationName" in animation) || !animation.effect) continue;
        if (animation.playState === "finished") continue;
        const timing = animation.effect.getComputedTiming();
        if (!Number.isFinite(timing.endTime)) continue;
        if (timing.localTime === null || timing.localTime < timing.endTime) continue;
        try {
          animation.finish();
          finished += 1;
        } catch {
          // An animation the page cancelled meanwhile: nothing to finish.
        }
      }
      return finished;
    },
    probe(t, x, y) {
      document.documentElement.style.setProperty("--recorder-t", t);
      // Before the counts: an animation or a transition whose time is up is
      // finished here, and is no longer running when the animations are
      // counted.
      state.finishEnded();
      const clock = window.__recorderTransitions;
      const transitions = clock ? clock.sync() : 0;
      return {
        mutations: state.mutations,
        hovered: state.idOf(document.elementFromPoint(x, y)),
        animations: document.getAnimations().length,
        transitions,
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
 * Plays the page's CSS transitions on the page's own clock.
 *
 * A transition's timing is fixed when it starts, at the style change, and it
 * runs on the compositor's clock, which the fake clock does not touch. So
 * the trick that scrubs animations, a delay read from a custom property
 * every frame, cannot move one. The Web Animations API can: every running
 * transition is a `CSSTransition` in `document.getAnimations()`, with a
 * writable `currentTime`.
 *
 * `sync()` takes over each transition the first time it sees one: pauses it,
 * and keeps the page's clock at that moment as its start. Then, every time
 * it runs, it sets the transition to the page's time since that start, and
 * once its effect's end is reached, finishes it, so `transitionend` fires and
 * whatever waits for it runs (Leaflet ending a zoom, a dialog unmounting).
 * It answers how many are still running.
 *
 * The start is the first sight, not the style change itself, which nothing
 * sees: the driver syncs after every move of the clock, so a transition
 * starts on the frame after the change that caused it, at most a frame late,
 * and the same frame every run. Until then it runs a few milliseconds on the
 * compositor in real time; setting it corrects that, and nothing is
 * photographed in between, since the driver photographs a frame only after
 * the probe that syncs it.
 *
 * The page's clock is the one the app's timers run on, not the clip's
 * authored time, so a transition and a timer the app set beside it stay
 * together: Leaflet ends a 250 ms zoom on a 250 ms timer.
 *
 * Only the top frame: the driver's probe runs there, and nothing would move
 * a subframe's transitions, so the freeze stylesheet keeps those zeroed.
 * CSS animations are left to their scrub, and animations a script made with
 * `element.animate()` are the app's own.
 */
export const TRANSITION_CLOCK_SCRIPT = `(() => {
  if (window !== window.top) return;
  const started = new WeakMap();
  window.__recorderTransitions = {
    sync() {
      const now = performance.now();
      let running = 0;
      for (const animation of document.getAnimations()) {
        if (!("transitionProperty" in animation)) continue;
        let start = started.get(animation);
        if (start === undefined) {
          start = now;
          started.set(animation, start);
        }
        const end = animation.effect
          ? animation.effect.getComputedTiming().endTime
          : 0;
        if (now - start >= end) {
          animation.finish();
          continue;
        }
        animation.pause();
        animation.currentTime = now - start;
        running += 1;
      }
      return running;
    },
  };
})();`;

/**
 * Moves every running transition to the page's clock, and finishes every CSS
 * animation whose time is up, for the driver's waits that move the clock
 * without making a frame. The frame probe and the settle loop do both as
 * part of what they already ask the page.
 */
export const SYNC_TRANSITIONS =
  "(window.__recorder ? window.__recorder.finishEnded() : 0) + " +
  "(window.__recorderTransitions ? window.__recorderTransitions.sync() : 0)";

/**
 * Puts the page's CSS motion under the recorder's control.
 *
 * `page.clock` drives timers and requestAnimationFrame, but CSS transitions
 * and animations run on the compositor's own clock, which the fake clock does
 * not touch. Left alone they produce half-finished frames whose content
 * depends on how busy the machine was — the exact non-determinism this
 * recorder exists to remove.
 *
 * Transitions play by default, on the page's clock, through
 * `TRANSITION_CLOCK_SCRIPT`: a map that zooms with a transition is the
 * content of the clip, and a jump in its place reads as a broken video. With
 * `capture.transitions: "zero"` they are zeroed instead, as they always were
 * before: a state change lands in the frame after the one that caused it,
 * and the renderer's crossfade at a settle is all the motion there is. A
 * subframe's are always zeroed, since its clock is never synced.
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
export function freezeCss(zeroTransitions: boolean): string {
  const transitions = zeroTransitions
    ? "  transition-duration: 0s !important;\n  transition-delay: 0s !important;\n"
    : "";
  return `*, *::before, *::after {
${transitions}  animation-play-state: paused !important;
  animation-delay: calc(-1s * var(--recorder-t, 0)) !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}`;
}

export function freezeCssScript(transitions: Transitions): string {
  return `(() => {
  const zero = ${transitions === "zero"} || window !== window.top;
  const css = zero ? ${JSON.stringify(freezeCss(true))} : ${JSON.stringify(freezeCss(false))};
  const inject = () => {
    const style = document.createElement("style");
    style.id = "__recorder_freeze";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.head || document.documentElement) inject();
  else document.addEventListener("DOMContentLoaded", inject, { once: true });
})();`;
}

/**
 * What the driver learns from the page once per frame.
 *
 * One round trip does four jobs: it advances the page's CSS animations to
 * this frame's authored time and its transitions to the page's clock, and
 * reports the two things that decide whether this frame needs a screenshot.
 *
 * `hovered` is the identity of the element under the cursor, as a number. The
 * cursor glyph is drawn in post, so the pointer moving changes no pixel by
 * itself — what changes pixels is the pointer moving *onto something else*.
 * `elementFromPoint` runs the same hit test a real pointer event does, so when
 * it returns the same element as last frame, the `:hover` chain is the same
 * chain and no hover styling can have changed.
 *
 * `animations` is how many animations are running, transitions included. A
 * scrubbed animation repaints on every frame without touching the DOM, and so
 * does a transition on the clock, so while any is on screen — a spinner, a
 * progress bar, a zoom — every frame is genuinely different and none may be
 * skipped. `transitions` is how many of them are transitions still to finish.
 */
export const FRAME_PROBE = (seconds: number, x: number, y: number): string =>
  `window.__recorder.probe("${seconds.toFixed(4)}", ${x.toFixed(2)}, ${y.toFixed(2)})`;

export type FrameProbe = {
  mutations: number;
  /** Identity of the element under the cursor; 0 when there is none. */
  hovered: number;
  animations: number;
  /** Transitions on the page's clock that have not finished; 0 when zeroed. */
  transitions: number;
};

declare global {
  interface Window {
    __recorder?: {
      mutations: number;
      finishEnded(): number;
      probe(t: string, x: number, y: number): FrameProbe;
    };
    __recorderTransitions?: {
      sync(): number;
    };
  }
}
