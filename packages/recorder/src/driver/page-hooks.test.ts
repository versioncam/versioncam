import { describe, expect, it } from "vitest";
import { DEV_TOOLS_CSS, freezeCss, freezeCssScript } from "./page-hooks.js";

describe("the freeze stylesheet", () => {
  it("is, with transitions zeroed, the stylesheet every recording before 0.4.0 was made with", () => {
    // `capture.transitions: "zero"` promises the old recorder, so its
    // stylesheet is held to the old text, character for character.
    expect(freezeCss(true)).toBe(`*, *::before, *::after {
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  animation-play-state: paused !important;
  animation-delay: calc(-1s * var(--recorder-t, 0)) !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}`);
  });

  it("leaves transitions alone when they play, and keeps everything else", () => {
    const css = freezeCss(false);
    expect(css).not.toContain("transition");
    for (const rule of [
      "animation-play-state: paused !important;",
      "animation-delay: calc(-1s * var(--recorder-t, 0)) !important;",
      "scroll-behavior: auto !important;",
      "caret-color: transparent !important;",
    ]) {
      expect(css).toContain(rule);
    }
  });

  it("zeroes a subframe's transitions whatever the switch says", () => {
    // Nothing moves a subframe's clock, so playing there would be real time.
    expect(freezeCssScript("play")).toContain(
      "const zero = false || window !== window.top;",
    );
    expect(freezeCssScript("zero")).toContain(
      "const zero = true || window !== window.top;",
    );
  });
});

describe("the dev tools rule", () => {
  // A selector here hides what it matches from every clip, so what may be in it
  // is a decision. An error overlay of its own must never be.
  it("leaves Vite's error overlay alone", () => {
    expect(DEV_TOOLS_CSS).not.toContain("error-overlay");
  });

  it("goes in with the freeze, in its own element, so it can come out again", () => {
    expect(freezeCssScript("play")).toContain('"__recorder_dev_tools"');
    expect(freezeCssScript("zero")).toContain(JSON.stringify(DEV_TOOLS_CSS));
  });
});
