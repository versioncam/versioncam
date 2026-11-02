import { describe, expect, it } from "vitest";
import { fileRows } from "./file-window.js";

describe("a file window's rows", () => {
  it("work out the type, size and kind from the name and the contents", () => {
    const [csv, png, other, one] = fileRows([
      { name: "cases.csv", content: "x".repeat(3000) },
      { name: "map.PNG" },
      { name: "README" },
      { name: "a.txt", content: "a" },
    ]);
    expect(csv).toMatchObject({
      type: "text/csv",
      size: "3 KB",
      kind: "CSV document",
    });
    expect(png).toMatchObject({
      type: "image/png",
      size: "0 bytes",
      kind: "PNG image",
    });
    expect(other).toMatchObject({
      type: "application/octet-stream",
      kind: "Document",
    });
    expect(one.size).toBe("1 byte");
  });

  it("take what is given over what they would work out", () => {
    const [row] = fileRows([
      { name: "runs.csv", content: "1", type: "text/plain", size: "12 MB" },
    ]);
    expect(row).toMatchObject({ type: "text/plain", size: "12 MB" });
  });

  it("refuse a window with nothing in it, or a file with no name", () => {
    expect(() => fileRows([])).toThrow(/list at least one file/);
    expect(() => fileRows([{ name: "" }])).toThrow(/file 0 has no name/);
  });
});
