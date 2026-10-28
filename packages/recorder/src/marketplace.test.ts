import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The repository is a Claude Code plugin marketplace of one plugin: this
 * package's skill, which `/plugin install versioncam --marketplace
 * versioncam/versioncam` installs without the npm package. The marketplace
 * file at the repository's root and the plugin's own manifest each say what
 * the plugin is called and which version it is, and Claude Code offers an
 * update when the version moves. A release bumps package.json; this is the
 * check that the other two moved with it, and that the entry still points at
 * the plugin and describes it in the plugin's own words.
 *
 * It lives in this package because the root runner reads only package
 * sources; what it checks is the root's file.
 */
const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(PACKAGE, "..", "..");

const read = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("the plugin marketplace", () => {
  const marketplace = read(join(ROOT, ".claude-plugin", "marketplace.json"));
  const plugins = marketplace.plugins as Record<string, unknown>[];
  const manifest = read(
    join(PACKAGE, "plugin", ".claude-plugin", "plugin.json"),
  );
  const pkg = read(join(PACKAGE, "package.json"));

  it("lists this package's plugin, under the plugin's own name", () => {
    expect(marketplace.name).toBe("versioncam");
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe(manifest.name);
    expect(plugins[0].description).toBe(manifest.description);
  });

  it("points at the plugin directory, from the repository's root", () => {
    const source = plugins[0].source as string;
    expect(source.startsWith("./")).toBe(true);
    expect(
      existsSync(join(ROOT, source, ".claude-plugin", "plugin.json")),
    ).toBe(true);
    expect(join(ROOT, source)).toBe(join(PACKAGE, "plugin"));
  });

  it("carries the package's version, in the entry and in the manifest", () => {
    expect(plugins[0].version).toBe(pkg.version);
    expect(manifest.version).toBe(pkg.version);
  });

  it("uses no long dash where Claude Code shows the text", () => {
    const text = readFileSync(
      join(ROOT, ".claude-plugin", "marketplace.json"),
      "utf8",
    );
    expect(text.includes("—")).toBe(false);
  });
});
