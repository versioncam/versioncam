/**
 * Where a recording's real time went.
 *
 * Deliberately not written into the timeline: two recordings of one script
 * must differ in no byte, which is why `recordedAt` is fixed to the epoch. A
 * measurement of how busy this machine was is the opposite of that, so it is
 * reported to whoever asked for the recording and not stored beside it.
 *
 * The buckets do not overlap. `settle()` is called by the clip script between
 * advances, never inside one, so no millisecond is counted twice.
 */
export type RecordingTiming = {
  /** Navigation and sign-in. */
  openMs: number;
  /** Every `settle()`, including the one inside `open()`. */
  settleMs: number;
  /** The frame loop, captures included. */
  framesMs: number;
  /** Validating and writing the timeline. */
  writeMs: number;
  captured: number;
  skipped: number;
};

export function emptyTiming(): RecordingTiming {
  return {
    openMs: 0,
    settleMs: 0,
    framesMs: 0,
    writeMs: 0,
    captured: 0,
    skipped: 0,
  };
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * One line saying where the next second would have to come from.
 *
 * The capture counts ride along with the frame bucket because they explain it:
 * a frame loop is expensive in proportion to how many screenshots it took.
 */
export function formatTiming(timing: RecordingTiming): string {
  const frames =
    timing.skipped > 0
      ? `frames ${secs(timing.framesMs)} (${timing.captured} captured, ${timing.skipped} skipped)`
      : `frames ${secs(timing.framesMs)} (${timing.captured} captured)`;
  return [
    `open ${secs(timing.openMs)}`,
    `settles ${secs(timing.settleMs)}`,
    frames,
    `write ${secs(timing.writeMs)}`,
  ].join(" · ");
}
