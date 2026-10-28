import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What npm publishes says nothing that belongs to someone else.
 *
 * Every comment in `src/` ships — the declarations put them in a user's
 * editor — and the README, the DSL reference, the changelog and the skill
 * ship as written. The first published version carried a client's name in
 * three comments and, in the plugin's manifest, a personal email address.
 * This is the check that would have stopped it: the kinds of thing that must
 * never ship, looked for in everything the tarball is built from. Links to
 * this repository were on the list while it was private; it is public since
 * 2026-10-28, and the README sends people to it.
 */
const PACKAGE = fileURLToPath(new URL("..", import.meta.url));

const PRIVATE: [string, RegExp][] = [
  [
    "an app it was built against, or its owner",
    /pathgen|\bixo\b|ixo\.world|ixoworld|impacts-x|open-qi|qi-agent|qi-app/i,
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
 * GitHub repository the workflow runs in — with a 404, not a reason.
 */
const REQUIRED = '"url": "git+https://github.com/versioncam/versioncam.git",';

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

/**
 * Shipped words a stranger reads that version.cam does not render: the
 * skill's brief for the platform, whose sentences an agent passes on to the
 * person it works for, and the sources of the commands that brief runs,
 * whose messages a person reads in a terminal. Written under the rule, so
 * held to it; the skill's older briefs were not, and are not checked yet.
 */
const COPY = [
  "plugin/skills/versioncam/platform.md",
  "src/cli/commands/cloud.ts",
  ...readdirSync(join(PACKAGE, "src", "cloud"))
    .filter((file) => !file.endsWith(".test.ts"))
    .map((file) => `src/cloud/${file}`),
];

/** Every line of `files` with a long dash in it, as `file:line`. */
function longDashes(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const lines = readFileSync(join(PACKAGE, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.includes("—")) found.push(`${file}:${i + 1}`);
    });
  }
  return found;
}

describe("the pages version.cam renders", () => {
  // House style for anything a stranger reads: where an aside would go, a
  // sentence, a colon or a bracket, never a long dash. A page full of them
  // reads as one long parenthesis, and without a check they come back one
  // aside at a time.
  it("use no long dash", () => {
    expect(longDashes(PAGES)).toEqual([]);
  });
});

describe("the platform's words", () => {
  it("use no long dash either", () => {
    expect(COPY.length).toBeGreaterThan(2);
    expect(longDashes(COPY)).toEqual([]);
  });
});
