import { describe, expect, it } from "vitest";
import { pageFromArgument } from "./open-app.js";

const GIT_BASH = "C:/Program Files/Git/";

describe("pageFromArgument", () => {
  it("leaves a page or an address as it is, and asks nobody", () => {
    const never = () => {
      throw new Error("asked for no reason");
    };
    expect(pageFromArgument("/", never)).toBe("/");
    expect(pageFromArgument("/settings?tab=1", never)).toBe("/settings?tab=1");
    expect(pageFromArgument("http://localhost:3000/", never)).toBe(
      "http://localhost:3000/",
    );
  });

  it("puts back what Git Bash rewrote", () => {
    const root = () => GIT_BASH;
    expect(pageFromArgument("C:/Program Files/Git/", root)).toBe("/");
    expect(pageFromArgument("C:/Program Files/Git/settings", root)).toBe(
      "/settings",
    );
    expect(pageFromArgument("c:\\Program Files\\Git\\a\\b", root)).toBe("/a/b");
  });

  it("finds the root whether or not it ends in a slash", () => {
    expect(
      pageFromArgument("D:/tools/git/settings", () => "D:/tools/git"),
    ).toBe("/settings");
  });

  it("says what to do about a drive letter it cannot put back", () => {
    expect(() => pageFromArgument("C:/Program Files/Git/", () => null)).toThrow(
      /not a page of the app.*MSYS_NO_PATHCONV=1/,
    );
    expect(() => pageFromArgument("D:/elsewhere/", () => GIT_BASH)).toThrow(
      /not a page of the app/,
    );
  });
});
