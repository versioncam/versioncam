import { describe, expect, it } from "vitest";
import { chooseTargets } from "./render.js";

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
