import { describe, expect, it } from "vitest";
import { buildFilter } from "./sequence.js";

/** A rendered clip of `duration` seconds, its rate as ffprobe gives it. */
const clip = (id: string, duration: number, frameRate = "60/1") => ({
  id,
  path: `${id}.mp4`,
  duration,
  frameRate,
});

describe("buildFilter", () => {
  it("crossfades clips of one rate straight from the files", () => {
    // The filter every sequence had before clips of two rates could be
    // joined, and the one a sequence of one rate still gets. The second
    // crossfade starts 0.4 s before the first two clips' joined end, 4.6 s,
    // not before the 5 s their durations add up to.
    const { filter, label, total } = buildFilter([
      clip("a", 2),
      clip("b", 3),
      clip("c", 1),
    ]);
    expect(filter).toBe(
      "[0:v][1:v]xfade=transition=fade:duration=0.4:offset=1.600[x1];" +
        "[x1][2:v]xfade=transition=fade:duration=0.4:offset=4.200[out]",
    );
    expect(label).toBe("out");
    expect(total).toBeCloseTo(5.2);
  });

  it("brings every clip to the highest rate first when the rates differ", () => {
    // A scene at 12 fps between recordings at 60 failed in ffmpeg: xfade
    // joins one frame rate and one timebase only. The 60 fps clips go
    // through `fps` too, since it sets the timebase, and the crossfades
    // start where they would have.
    const { filter, label, total } = buildFilter([
      clip("a", 2),
      clip("b", 1, "12/1"),
      clip("c", 2),
    ]);
    expect(filter).toBe(
      "[0:v]fps=60/1[f0];[1:v]fps=60/1[f1];[2:v]fps=60/1[f2];" +
        "[f0][f1]xfade=transition=fade:duration=0.4:offset=1.600[x1];" +
        "[x1][f2]xfade=transition=fade:duration=0.4:offset=2.200[out]",
    );
    expect(label).toBe("out");
    expect(total).toBeCloseTo(4.2);
  });

  it("does the same for a 15 fps draft ahead of full recordings", () => {
    // The highest rate is wherever it comes, not the first clip's.
    expect(buildFilter([clip("a", 2, "15/1"), clip("b", 2)]).filter).toBe(
      "[0:v]fps=60/1[f0];[1:v]fps=60/1[f1];" +
        "[f0][f1]xfade=transition=fade:duration=0.4:offset=1.600[out]",
    );
  });

  it("compares rates as numbers, and keeps the highest exactly as written", () => {
    // As text, 60/1 would sort above 120/1 and 30000/1001 above 30/1.
    expect(buildFilter([clip("a", 2), clip("b", 2, "120/1")]).filter).toMatch(
      /^\[0:v\]fps=120\/1\[f0\];\[1:v\]fps=120\/1\[f1\];/,
    );
    expect(
      buildFilter([clip("a", 2, "30000/1001"), clip("b", 2, "30/1")]).filter,
    ).toMatch(/^\[0:v\]fps=30\/1\[f0\];\[1:v\]fps=30\/1\[f1\];/);
    // NTSC's 29.97 is 30000/1001. The clip that sets the rate goes through
    // `fps` at it as well, and only its own exact rate leaves its frames
    // alone.
    expect(
      buildFilter([clip("a", 2, "30000/1001"), clip("b", 2, "24/1")]).filter,
    ).toMatch(/^\[0:v\]fps=30000\/1001\[f0\];\[1:v\]fps=30000\/1001\[f1\];/);
  });
});
