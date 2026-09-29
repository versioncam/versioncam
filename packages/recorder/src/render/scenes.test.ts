import { describe, expect, it } from "vitest";
import type { Scene } from "../scene.js";
import { missingScenes, readScenes } from "./scenes.js";

const FILE = "/app/demos/scenes/index.ts";

const intro: Scene = {
  id: "intro",
  title: "Intro",
  durationFrames: 60,
  fps: 60,
  draw() {},
};

/** The refusal's lines, or a failure that says the module was accepted. */
function refusal(module: Record<string, unknown>): string[] {
  const read = readScenes(module, FILE);
  if (!("error" in read)) throw new Error("the module was accepted");
  return read.error.split("\n");
}

describe("reading a scenes module", () => {
  it("reads a default-exported record of scenes, by id", () => {
    expect(readScenes({ default: { intro } }, FILE)).toEqual({
      scenes: { intro },
    });
  });

  it("reads an empty record as no scenes, which is what it says", () => {
    expect(readScenes({ default: {} }, FILE)).toEqual({ scenes: {} });
  });

  it("refuses a module with no default export, and names the one it has", () => {
    // The module that made this check: the record was all there, as a named
    // export, and a reader of the default found nothing and said nothing.
    const [what, shape, fix] = refusal({ SCENES: { intro } });
    expect(what).toBe(`${FILE} has no default export. It exports SCENES.`);
    expect(shape).toContain("Record<string, Scene>");
    expect(shape).toContain("export default { [intro.id]: intro }");
    expect(fix).toBe("SCENES is one: add `export default SCENES`.");
  });

  it("suggests no fix it cannot be sure of", () => {
    // Scenes exported one by one are no record, and two records are a
    // choice the module's author has to make.
    expect(refusal({ intro })).toHaveLength(2);
    expect(refusal({ intro })[0]).toBe(
      `${FILE} has no default export. It exports intro.`,
    );
    expect(refusal({ A: { intro }, B: { intro } })).toHaveLength(2);
    expect(refusal({ EMPTY: {} })).toHaveLength(2);
    expect(refusal({})[0]).toBe(`${FILE} has no default export.`);
  });

  it("refuses a default export of the wrong shape, and says which", () => {
    const first = (value: unknown) => refusal({ default: value })[0];

    // The two a clip file invites: one clip, or an array of them.
    expect(first(intro)).toBe(
      `${FILE} default-exports a single scene rather than a record of them.`,
    );
    expect(first([intro])).toBe(`${FILE} default-exports an array.`);

    expect(first(() => intro)).toBe(`${FILE} default-exports a function.`);
    expect(first(null)).toBe(`${FILE} default-exports null.`);
    expect(first("intro")).toBe(`${FILE} default-exports a string.`);

    const shape = refusal({ default: [intro] })[1];
    expect(shape).toContain("Record<string, Scene>");
  });

  it("names the entry that is not a scene, and what is wrong with it", () => {
    const first = (entry: unknown) => refusal({ default: { intro: entry } })[0];

    expect(first("intro")).toBe(
      `${FILE} default-exports a record in which "intro" is a string, not a scene.`,
    );
    expect(first({ ...intro, draw: undefined })).toBe(
      `${FILE} default-exports a record in which "intro" has no draw(ctx, frame, canvas).`,
    );
    for (const durationFrames of [0, 2.5, undefined]) {
      expect(first({ ...intro, durationFrames })).toBe(
        `${FILE} default-exports a record in which "intro" has durationFrames ` +
          `${durationFrames}, where a whole number of frames, 1 or more, belongs.`,
      );
    }
    for (const [fps, written] of [
      [0, "0"],
      [Number.NaN, "NaN"],
      ["60", '"60"'],
    ]) {
      expect(first({ ...intro, fps })).toBe(
        `${FILE} default-exports a record in which "intro" has fps ${written}, ` +
          "where a number above 0 belongs.",
      );
    }
  });
});

describe("asking for a scene the module does not define", () => {
  it("says which scenes there are", () => {
    expect(missingScenes(["outro"], ["intro"], FILE)).toBe(
      `No scene called "outro". ${FILE} defines intro.`,
    );
    expect(missingScenes(["a", "b"], [], FILE)).toBe(
      `No scenes called "a", "b". ${FILE} defines none.`,
    );
  });

  it("says when the config names no scenes module at all", () => {
    expect(missingScenes(["intro"], [], null)).toBe(
      'No scene called "intro". The config names no `scenes` module.',
    );
  });
});
