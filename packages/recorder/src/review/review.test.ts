import { describe, expect, it } from "vitest";
import { emptyTimeline } from "../core/timeline.js";
import type { Mark, Rect, Timeline } from "../core/timeline.js";
import type { SettleReport } from "../driver/settle.js";
import { formatReview, reviewRecording } from "./review.js";
import type { ReviewInput, ReviewResult } from "./review.js";

/**
 * Every clause, on timelines written by hand.
 *
 * Hand-written rather than recorded because the failures being checked for are
 * ones a working recorder will not produce on demand: a settle that timed out,
 * a beat that changed nothing, a camera key past the end of the clip. Driving
 * a browser into each of those states would be a day's fixtures and would test
 * the browser.
 */

const FPS = 60;

/** A ten-second clip whose picture changes at every frame index given. */
function timelineOf(options: {
  seconds?: number;
  marks?: Mark[];
  changesAt?: number[];
}): Timeline {
  const timeline = emptyTimeline({
    clipId: "synthetic",
    fps: FPS,
    viewport: { width: 1000, height: 700, dpr: 2 },
    title: "Synthetic",
    appCommit: "unknown",
    baseUrl: "http://fixture.local",
    recordedAt: "1970-01-01T00:00:00.000Z",
  });
  timeline.durationFrames = Math.round((options.seconds ?? 10) * FPS);
  timeline.marks = options.marks ?? [];

  // One state per "change", every frame reusing the last one otherwise: the
  // shape every real recording has.
  const changes = new Set(options.changesAt ?? []);
  let state = 0;
  for (let frame = 0; frame < timeline.durationFrames; frame += 1) {
    if (frame > 0 && changes.has(frame)) state += 1;
    timeline.frames.push(state);
  }
  timeline.states = Array.from(
    { length: state + 1 },
    (_, i) => `${String(i).padStart(4, "0")}.png`,
  );
  return timeline;
}

const settle = (overrides: Partial<SettleReport> = {}): SettleReport => ({
  label: "settled",
  elapsedMs: 120,
  ticks: 8,
  timedOut: false,
  lastBlocker: "none",
  ...overrides,
});

const beatsClip = () =>
  timelineOf({
    marks: [
      { frame: 0, label: "open /" },
      { frame: 200, label: "filtered" },
      { frame: 400, label: "selected" },
    ],
    changesAt: [100, 300, 500],
  });

const review = (input: Partial<ReviewInput> = {}): ReviewResult =>
  reviewRecording({
    timeline: input.timeline ?? beatsClip(),
    settles: input.settles ?? [settle()],
    beats: input.beats,
    bounds: input.bounds,
  });

const item = (result: ReviewResult, check: string) =>
  result.items.find((i) => i.check === check)!;

describe("reviewRecording", () => {
  it("passes a clip that does everything it said it would", () => {
    const result = review({
      beats: [{ label: "filtered" }, { label: "selected" }],
    });
    expect(result.pass).toBe(true);
    expect(result.items.map((i) => i.check)).toEqual([
      "duration",
      "settles",
      "beats",
      "progress",
      "rendered",
      "onscreen",
    ]);
    for (const clause of result.items) expect(clause.pass).toBe(true);
  });

  it("fails a clip that is too short or too long, and says by how much", () => {
    const short = review({ timeline: timelineOf({ seconds: 4 }) });
    expect(short.pass).toBe(false);
    expect(item(short, "duration").detail).toBe("4.0s is outside 9–11s");

    const long = review({ timeline: timelineOf({ seconds: 30 }) });
    expect(item(long, "duration").pass).toBe(false);

    // The bounds are the caller's to set: a title card is not a ten-second demo.
    const allowed = review({
      timeline: timelineOf({ seconds: 4 }),
      bounds: { minSeconds: 3, maxSeconds: 5 },
    });
    expect(item(allowed, "duration").pass).toBe(true);
    expect(allowed.pass).toBe(true);
  });

  it("fails when a settle gave up, naming what it was waiting on", () => {
    const result = review({
      settles: [
        settle(),
        settle({
          label: "results",
          timedOut: true,
          lastBlocker: "requests(2)",
        }),
      ],
    });
    expect(result.pass).toBe(false);
    expect(item(result, "settles").detail).toContain("results");
    expect(item(result, "settles").detail).toContain("requests(2)");
  });

  it("says nothing about settles it was not given", () => {
    // A recording made before `settles.json` existed. Vacuously fine, and the
    // line says so rather than claiming a clean bill of health.
    const result = review({ settles: [] });
    expect(item(result, "settles").pass).toBe(true);
    expect(item(result, "settles").detail).toContain("nothing to check");
  });

  it("fails a beat the clip never marked, and lists the ones it did", () => {
    const result = review({
      beats: [
        { label: "filtered" },
        { label: "cancelled", expect: "the row goes" },
      ],
    });
    expect(result.pass).toBe(false);
    const beats = item(result, "beats");
    expect(beats.detail).toContain('"cancelled"');
    // The labels that do exist, because the usual cause is a spelling.
    expect(beats.detail).toContain('"filtered"');
    expect(beats.detail).toContain('"selected"');
  });

  it("fails a beat that changed nothing on screen", () => {
    // Two marks with one state across the whole span between them: the click
    // happened, the wait happened, and the page looked identical.
    const result = review({
      timeline: timelineOf({
        marks: [
          { frame: 0, label: "open /" },
          { frame: 200, label: "filtered" },
          { frame: 400, label: "selected" },
        ],
        changesAt: [100, 500],
      }),
    });
    expect(result.pass).toBe(false);
    const progress = item(result, "progress");
    expect(progress.detail).toContain('"filtered"');
    expect(progress.detail).toContain('"selected"');
    expect(progress.detail).toContain("nothing changed");
  });

  it("has nothing to say about progress with fewer than two beats", () => {
    const result = review({
      timeline: timelineOf({ marks: [{ frame: 0, label: "open /" }] }),
    });
    expect(item(result, "progress").pass).toBe(true);
    expect(result.pass).toBe(true);
  });

  it("warns, without failing, about a camera key past the last frame", () => {
    const timeline = beatsClip();
    // What a bare `camera.reset()` at the end of a clip writes: a hold at the
    // final instant and a glide that runs past it.
    const full = { x: 0, y: 0, w: 1000, h: 700 };
    timeline.camera.push({ t: 10, rect: full, ease: "hold" });
    timeline.camera.push({ t: 11.1, rect: full, ease: "minjerk" });

    const result = review({ timeline });
    const rendered = item(result, "rendered");
    expect(rendered.pass).toBe(false);
    expect(rendered.warning).toBe(true);
    expect(rendered.detail).toContain("camera key at 11.1s");
    // A warning is a finding, not a verdict.
    expect(result.pass).toBe(true);
  });

  it("warns about a highlight or a caption written after the end", () => {
    const timeline = beatsClip();
    timeline.highlights.push({
      t0: 10.5,
      t1: 12,
      rect: { x: 0, y: 0, w: 10, h: 10 },
      style: "ring",
    });
    timeline.captions.push({ t0: 12, t1: 13, text: "Too late" });

    const result = review({ timeline });
    const rendered = item(result, "rendered");
    expect(rendered.detail).toContain("highlight at 10.5s");
    expect(rendered.detail).toContain('"Too late"');
    expect(result.pass).toBe(true);
  });

  it("does not warn about a write on the last frame itself", () => {
    const timeline = beatsClip();
    // 600 frames at 60fps: the last one starts at 9.983s, and a highlight
    // written there is seen, briefly. The check is which frame it lands on,
    // not which second.
    timeline.highlights.push({
      t0: 599 / FPS,
      t1: 10,
      rect: { x: 0, y: 0, w: 10, h: 10 },
      style: "ring",
    });
    expect(item(review({ timeline }), "rendered").pass).toBe(true);
  });
});

describe("formatReview", () => {
  it("leads with the verdict and gives a line to each clause", () => {
    const text = formatReview(
      "02-find",
      review({ beats: [{ label: "gone" }] }),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("02-find: FAIL");
    // The verdict, then a line per clause.
    expect(lines).toHaveLength(7);
    expect(text).toContain("✗ beats");
    expect(text).toContain("✓ duration");
  });

  it("marks a warning as neither a pass nor a failure", () => {
    const timeline = beatsClip();
    timeline.captions.push({ t0: 12, t1: 13, text: "Too late" });
    const text = formatReview("02-find", review({ timeline }));
    expect(text).toContain("02-find: PASS");
    expect(text).toContain("! rendered");
  });
});

describe("a highlight nobody can see", () => {
  const withHighlight = (rect: Rect): Timeline => {
    const timeline = timelineOf({ seconds: 10 });
    timeline.highlights = [{ t0: 0.5, t1: 2, rect, style: "ring" }];
    return timeline;
  };

  it("warns when a ring is drawn below the fold", () => {
    // The example app's status line measures at y 928 in an 800px viewport,
    // and the clip that rings it drew that ring off the bottom of every frame
    // from the day it was written. `record` succeeded, `review` had no clause,
    // and the video simply lacked the ring it was meant to end on. This
    // timeline is 1000x700, so 928 is comfortably below its fold too.
    const result = reviewRecording({
      timeline: withHighlight({ x: 421, y: 928, w: 578, h: 20 }),
    });
    const item = result.items.find((i) => i.check === "onscreen");
    expect(item?.pass).toBe(false);
    expect(item?.warning).toBe(true);
    expect(item?.detail).toContain("928");
    // A warning, not a failure: the camera may legitimately be elsewhere.
    expect(result.pass).toBe(true);
  });

  it("is content with a ring inside the viewport", () => {
    const result = reviewRecording({
      timeline: withHighlight({ x: 100, y: 200, w: 300, h: 40 }),
    });
    expect(result.items.find((i) => i.check === "onscreen")?.pass).toBe(true);
  });

  it("allows a highlight that is partly on screen", () => {
    // A panel taller than the viewport is normal, and a ring around it reads
    // fine as a three-sided border.
    const result = reviewRecording({
      timeline: withHighlight({ x: 100, y: 500, w: 300, h: 400 }),
    });
    expect(result.items.find((i) => i.check === "onscreen")?.pass).toBe(true);
  });
});
