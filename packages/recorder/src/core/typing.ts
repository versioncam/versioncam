import { jitter } from "./rng";

const BASE_MS = 55;
const SPREAD_MS = 25;
const AFTER_SPACE_MS = 80;
const AFTER_PUNCTUATION_MS = 160;

const PUNCTUATION = new Set([".", ",", "?", "!", ":", ";"]);

/**
 * When each character of `text` gets typed, in milliseconds from the start.
 *
 * Constant-rate typing is one of the strongest tells that a demo is scripted.
 * Real typing varies per keystroke and pauses at word and clause boundaries,
 * so the pause goes *after* a space or a comma, where a person's hands
 * actually hesitate. No fake typos: they read as a gimmick on second viewing
 * and make the clip impossible to re-cut.
 */
export function typingSchedule(text: string, rng: () => number): number[] {
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i < text.length; i += 1) {
    const previous = i > 0 ? text[i - 1] : "";
    let extra = 0;
    if (previous === " ") extra = AFTER_SPACE_MS;
    else if (PUNCTUATION.has(previous)) extra = AFTER_PUNCTUATION_MS;

    t += Math.max(10, BASE_MS + jitter(rng, SPREAD_MS)) + extra;
    times.push(t);
  }
  return times;
}

/** Total time `typingSchedule` spans, in milliseconds. */
export function typingDuration(times: number[]): number {
  return times.length === 0 ? 0 : times[times.length - 1];
}
