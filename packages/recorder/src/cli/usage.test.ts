import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USAGE } from "./usage.js";

/** The usage text's command lines, as the README shows them. */
function usageLines(): string[] {
  return USAGE.split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.slice(2).trimEnd());
}

/** The fenced block under the README's `## Commands`. */
function readmeLines(): string[] {
  const readme = readFileSync(
    new URL("../../README.md", import.meta.url),
    "utf8",
  );
  const section = readme.split(/^## Commands$/m)[1] ?? "";
  const block = /```\n([\s\S]*?)```/.exec(section)?.[1] ?? "";
  return block
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.trimEnd());
}

describe("the README's commands", () => {
  // The README is also version.cam's documentation, so a command it lists
  // that the CLI does not have — or the reverse — is a promise to strangers.
  it("are the CLI's, line for line", () => {
    expect(readmeLines()).toEqual(usageLines());
  });
});
