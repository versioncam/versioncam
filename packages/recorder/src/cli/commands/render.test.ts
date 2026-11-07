import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseTargets, renderingLine } from "./render.js";

const RECORDED = ["02-a", "04-b", "05-trial"];
const DEFINED = ["01-x", "03-y"];

describe("what render renders", () => {
  it("renders everything when nothing is named", () => {
    // Every recording on disk, including one left from a trial run: the
    // reason to name ids.
    expect(chooseTargets(RECORDED, DEFINED, [], [])).toEqual({
      recordings: RECORDED,
      scenes: DEFINED,
      unmatched: [],
    });
  });

  it("lets ids choose recordings and scenes alike, by substring", () => {
    expect(chooseTargets(RECORDED, DEFINED, ["02", "03"], [])).toEqual({
      recordings: ["02-a"],
      scenes: ["03-y"],
      unmatched: [],
    });
  });

  it("takes an exact id alone, so a phone clip's name does not catch both", () => {
    const recorded = ["01-checkout", "01-checkout-mobile", "02-search"];
    expect(chooseTargets(recorded, [], ["01-checkout"], []).recordings).toEqual(
      ["01-checkout"],
    );
    expect(
      chooseTargets(recorded, [], ["01-checkout-mobile"], []).recordings,
    ).toEqual(["01-checkout-mobile"]);
    expect(chooseTargets(recorded, [], ["checkout"], []).recordings).toEqual([
      "01-checkout",
      "01-checkout-mobile",
    ]);
  });

  it("renders a --scene whatever the ids say", () => {
    // `render 02-a 04-b --scene 01-x` used to render no scene: the named one
    // was filtered by the ids as well, and matched none of them.
    expect(
      chooseTargets(RECORDED, DEFINED, ["02-a", "04-b"], ["01-x"]),
    ).toEqual({
      recordings: ["02-a", "04-b"],
      scenes: ["01-x"],
      unmatched: [],
    });
    // And the ids still choose among the scenes --scene did not name, in the
    // module's order.
    expect(chooseTargets(RECORDED, DEFINED, ["02-a", "03"], ["01-x"])).toEqual({
      recordings: ["02-a"],
      scenes: ["01-x", "03-y"],
      unmatched: [],
    });
  });

  it("renders only the named scenes when --scene comes without ids", () => {
    expect(chooseTargets(RECORDED, DEFINED, [], ["03-y"])).toEqual({
      recordings: RECORDED,
      scenes: ["03-y"],
      unmatched: [],
    });
  });

  it("names an id that chooses nothing", () => {
    expect(
      chooseTargets(RECORDED, DEFINED, ["02", "07"], []).unmatched,
    ).toEqual(["07"]);
  });
});

describe("what render says as it starts a clip", () => {
  const dir = mkdtempSync(join(tmpdir(), "versioncam-render-"));
  mkdirSync(join(dir, "01-a"));
  writeFileSync(
    join(dir, "01-a", "timeline.json"),
    JSON.stringify({
      version: 1,
      clipId: "01-a",
      fps: 60,
      durationFrames: 402,
    }),
  );

  it("says the clip, its frames and its rate, on a terminal", () => {
    expect(renderingLine("01-a", dir, true)).toBe(
      "rendering 01-a, 402 frames at 60 fps\n",
    );
  });

  it("says nothing without one, so a script reads only the results", () => {
    expect(renderingLine("01-a", dir, false)).toBeNull();
  });

  it("names the clip alone when its timeline cannot be read", () => {
    expect(renderingLine("02-gone", dir, true)).toBe("rendering 02-gone\n");
  });
});
