import { describe, expect, it } from "vitest";
import { freezeCss, freezeCssScript } from "./page-hooks.js";

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
