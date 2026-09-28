import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USAGE } from "./usage.js";

type Group = { title: string; lines: string[] };

/**
 * The usage text's groups: a title flush left, then the command lines under
 * it, indented. The first line and the last are not groups, and nothing
 * indented follows them.
 */
function usageGroups(): Group[] {
  const lines = USAGE.split("\n");
  const groups: Group[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith("  ")) {
      groups.at(-1)?.lines.push(line.slice(2).trimEnd());
    } else if (lines[i + 1]?.startsWith("  ")) {
      groups.push({ title: line, lines: [] });
    }
  });
  return groups;
}

/** The README's `## Commands`: a `###` per group, each with one fenced block. */
function readmeGroups(): Group[] {
  const readme = readFileSync(
    new URL("../../README.md", import.meta.url),
    "utf8",
  );
  const section = readme.split(/^## Commands$/m)[1]?.split(/^## /m)[0] ?? "";
  return [...section.matchAll(/^### (.+)\n[\s\S]*?```\n([\s\S]*?)```/gm)].map(
    ([, title, block]) => ({
      title,
      lines: block
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => line.trimEnd()),
    }),
  );
}

describe("the README's commands", () => {
  // The README is also version.cam's documentation, so a command it lists
  // that the CLI does not have, or the reverse, is a promise to strangers.
  it("are the CLI's, group for group and line for line", () => {
    const groups = usageGroups();
    expect(groups.length).toBeGreaterThan(1);
    expect(readmeGroups()).toEqual(groups);
  });
});
