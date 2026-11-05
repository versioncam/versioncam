import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLAGS, USAGE, unknownFlag } from "./usage.js";

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

describe("the flags a command reads", () => {
  const commands = new URL("./commands/", import.meta.url);

  // A flag a command gains and this table does not would be refused before the
  // command ever saw it, so the table is read off the commands' own code.
  it("are the table's, command for command", () => {
    const sources = readdirSync(commands).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );
    for (const file of sources) {
      const name = file.replace(/\.ts$/, "");
      if (!(name in FLAGS)) continue;
      const source = readFileSync(new URL(file, commands), "utf8");
      const read = [
        ...source.matchAll(
          /["']?([a-z][a-z-]*)["']?: \{\s*type: "(?:boolean|string)"/g,
        ),
      ].map((match) => match[1]);
      expect([...read].sort(), name).toEqual([...FLAGS[name]].sort());
    }
  });

  it("every one the usage page lists is in the table", () => {
    let command = "";
    for (const line of USAGE.split("\n")) {
      command = /^ {2}versioncam ([a-z]+)/.exec(line)?.[1] ?? command;
      const flag = /^ {6}--([a-z-]+)/.exec(line)?.[1];
      if (flag) expect(FLAGS[command], `${command} --${flag}`).toContain(flag);
    }
  });

  it("refuses a typo and passes what is known", () => {
    expect(unknownFlag("stability", ["stability", "--fulll"])).toBe("--fulll");
    expect(unknownFlag("stability", ["stability", "--full"])).toBeNull();
    expect(unknownFlag("review", ["review", "x", "--min=9"])).toBeNull();
    expect(unknownFlag("doctor", ["doctor", "--json"])).toBe("--json");
    // After `--` nothing is a flag.
    expect(unknownFlag("record", ["record", "--", "--odd"])).toBeNull();
  });
});
