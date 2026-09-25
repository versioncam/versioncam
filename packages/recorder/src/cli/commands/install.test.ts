import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { installArgv, pinnedPlaywright } from "./install.js";

describe("versioncam install", () => {
  it("installs Chromium through the Playwright versioncam depends on", () => {
    const { version, cli } = pinnedPlaywright();
    // The version the package pins, not whatever a range would resolve to.
    const manifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(version).toBe(manifest.dependencies.playwright);
    expect(existsSync(cli)).toBe(true);
  });

  it("asks for the system libraries only when told to", () => {
    expect(installArgv("node", "/pw/cli.js", false)).toEqual([
      "node",
      "/pw/cli.js",
      "install",
      "chromium",
    ]);
    expect(installArgv("node", "/pw/cli.js", true)).toEqual([
      "node",
      "/pw/cli.js",
      "install",
      "--with-deps",
      "chromium",
    ]);
  });
});
