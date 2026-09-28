import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What npm publishes says nothing that belongs to someone else.
 *
 * The package is public and this repository is not. Every comment in `src/`
 * ships — the declarations put them in a user's editor — and the README, the
 * DSL reference, the changelog and the skill ship as written. The first
 * published version carried a client's name in three comments and, in the
 * plugin's manifest, a personal email address and links into this private
 * repository. This is the check that would have stopped it: the kinds of
 * thing that must never ship, looked for in everything the tarball is built
 * from.
 */
const PACKAGE = fileURLToPath(new URL("..", import.meta.url));

const PRIVATE: [string, RegExp][] = [
  [
    "an app it was built against, or its owner",
    /pathgen|\bixo\b|ixo\.world|ixoworld|impacts-x|open-qi|qi-agent|qi-app/i,
  ],
  ["this private repository", /github\.com\/petbul\/versioncam(?!-home)/],
  ["a personal email address", /@(gmail|icloud|me|outlook|hotmail)\.com/i],
  ["a path on someone's machine", /\/Users\/|~\/Documents/],
];

/**
 * The files the tarball is built from: the `files` list in package.json,
 * with `src/` standing in for the `dist/` it compiles to, and without the
 * unit tests, which `files` leaves out.
 */
function shipped(): string[] {
  const under = (dir: string): string[] =>
    readdirSync(join(PACKAGE, dir), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(PACKAGE, join(e.parentPath, e.name)));
  return [
    "README.md",
    "dsl.md",
    "CHANGELOG.md",
    "LICENSE.md",
    "package.json",
    ...under("bin"),
    ...under("plugin"),
    ...under("render-page"),
    ...under("src").filter((f) => !/\.test\.ts$/.test(f)),
  ];
}

describe("the published package", () => {
  it("names no client, private repository, personal address or local path", () => {
    const found: string[] = [];
    for (const file of shipped()) {
      const lines = readFileSync(join(PACKAGE, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const [what, pattern] of PRIVATE) {
          if (pattern.test(line)) found.push(`${file}:${i + 1} — ${what}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});
