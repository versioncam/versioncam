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
  [
    "this private repository",
    /github\.com\/(?:petbul|versioncam)\/versioncam(?![\w-])/,
  ],
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

/**
 * The one place this repository's address has to appear: npm's trusted
 * publishing refuses a release whose `repository.url` does not name the
 * GitHub repository the workflow runs in — with a 404, not a reason. So the
 * manifest names it, a link only collaborators can open, and nothing else
 * may.
 */
const REQUIRED = '"url": "git+https://github.com/versioncam/versioncam.git",';

describe("the published package", () => {
  it("names no client, private repository, personal address or local path", () => {
    const found: string[] = [];
    for (const file of shipped()) {
      const lines = readFileSync(join(PACKAGE, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (file === "package.json" && line.trim() === REQUIRED) return;
        for (const [what, pattern] of PRIVATE) {
          if (pattern.test(line)) found.push(`${file}:${i + 1} — ${what}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it("names the repository it is published from, as trusted publishing needs", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, "package.json"), "utf8"),
    ) as { repository?: { url?: string } };
    expect(`"url": "${manifest.repository?.url}",`).toBe(REQUIRED);
  });
});

/**
 * The pages version.cam renders, which it reads from the published package:
 * the README's sections, the DSL reference, the skill's README and the
 * changelog.
 */
const PAGES = ["README.md", "dsl.md", "CHANGELOG.md", "plugin/README.md"];

describe("the pages version.cam renders", () => {
  // House style for anything a stranger reads: where an aside would go, a
  // sentence, a colon or a bracket, never a long dash. A page full of them
  // reads as one long parenthesis, and without a check they come back one
  // aside at a time.
  it("use no long dash", () => {
    const found: string[] = [];
    for (const file of PAGES) {
      const lines = readFileSync(join(PACKAGE, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes("—")) found.push(`${file}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });
});
