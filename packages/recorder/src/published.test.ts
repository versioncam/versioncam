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
 * whose messages a person reads in a terminal.
 */
const COPY = [
  "plugin/skills/versioncam/platform.md",
  "plugin/skills/versioncam/SKILL.md",
  "plugin/skills/versioncam/authoring.md",
  "plugin/skills/versioncam/onboarding.md",
  "plugin/agents/versioncam-reviewer.md",
  "src/cli/commands/cloud.ts",
  "src/cli/commands/ci.ts",
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

describe("what the commands print", () => {
  // The en dash slipped through because only the long one was looked for:
  // `review` said its duration bounds with one for a year. A string a command prints sits
  // on a line that is not a comment, which is as far as this needs to read.
  it("has no en dash and no long dash", () => {
    const sources = (dir: string): string[] =>
      readdirSync(join(PACKAGE, dir), { withFileTypes: true }).flatMap(
        (entry) =>
          entry.isDirectory()
            ? sources(`${dir}/${entry.name}`)
            : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
              ? [`${dir}/${entry.name}`]
              : [],
      );
    const found: string[] = [];
    for (const file of [
      ...sources("src/cli"),
      ...sources("src/review"),
      ...sources("src/render"),
    ]) {
      readFileSync(join(PACKAGE, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (/[\u2013\u2014]/.test(line.split(" // ")[0])) {
            found.push(`${file}:${i + 1}`);
          }
        });
    }
    expect(found).toEqual([]);
  });
});

/**
 * The sentences Peter read on 2026-11-07 and asked us to stop writing:
 * "Nothing is sold. Team is told. Can we speak more normally?" The rule
 * is docs/voice.md at the repository's root, and a reader is the guard;
 * this only stops these exact phrases coming back. Each hides who does
 * what behind a passive, or, for "the door", names sign in by a metaphor.
 */
const TRIPWIRE = /\b(is told|is sold|is asked for|nothing is sold|the door)\b/i;

/** The lines of `files` a reader sees: every line of a page, and the code lines of a source. */
function readLines(files: string[]): { at: string; line: string }[] {
  return files.flatMap((file) =>
    readFileSync(join(PACKAGE, file), "utf8")
      .split("\n")
      .map((line, i) => ({ at: `${file}:${i + 1}`, line }))
      .filter(
        ({ line }) => !file.endsWith(".ts") || !/^\s*(\/\/|\*|\/\*)/.test(line),
      )
      .map(({ at, line }) => ({
        at,
        line: file.endsWith(".ts") ? line.split(" // ")[0] : line,
      })),
  );
}

describe("the words a reader sees", () => {
  it("never say the phrases docs/voice.md was written to stop", () => {
    const sources = (dir: string): string[] =>
      readdirSync(join(PACKAGE, dir), { recursive: true, withFileTypes: true })
        .filter(
          (e) =>
            e.isFile() &&
            e.name.endsWith(".ts") &&
            !e.name.endsWith(".test.ts"),
        )
        .map((e) => relative(PACKAGE, join(e.parentPath, e.name)));
    const found = readLines([
      ...PAGES,
      ...COPY.filter((file) => file.endsWith(".md")),
      ...sources("src"),
    ])
      .filter(({ line }) => TRIPWIRE.test(line))
      .map(({ at }) => at);
    expect(found).toEqual([]);
  });
});
