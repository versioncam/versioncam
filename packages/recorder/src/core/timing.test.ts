import { describe, expect, it } from "vitest";
import { emptyTiming, formatTiming } from "./timing.js";

describe("the recording cost line", () => {
  it("says where the time went, in seconds", () => {
    expect(
      formatTiming({
        ...emptyTiming(),
        openMs: 1100,
        settleMs: 2400,
        framesMs: 2500,
        writeMs: 200,
        captured: 425,
      }),
    ).toBe(
      "open 1.1s · settles 2.4s · frames 2.5s (425 captured) · write 0.2s",
    );
  });

  it("reports what was skipped only once something has been", () => {
    // Before the gate exists there is nothing to skip, and a line that always
    // said "0 skipped" would be reporting a feature rather than a measurement.
    const gated = formatTiming({
      ...emptyTiming(),
      framesMs: 2500,
      captured: 31,
      skipped: 394,
    });
    expect(gated).toContain("(31 captured, 394 skipped)");
    expect(formatTiming({ ...emptyTiming(), captured: 31 })).toContain(
      "(31 captured)",
    );
  });
});
