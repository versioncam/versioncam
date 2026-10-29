import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  browserPaths,
  ensureFullBrowser,
  fullBrowserArgv,
  installArgv,
  pinnedPlaywright,
} from "./install.js";

const manifest = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };

describe("versioncam install", () => {
  it("installs Chromium through the Playwright versioncam depends on", () => {
    const { version, cli } = pinnedPlaywright();
    // The version the package pins, not whatever a range would resolve to.
    expect(version).toBe(manifest.dependencies.playwright);
    expect(existsSync(cli)).toBe(true);
  });

  it("reads the registry of the same Playwright it installs with", () => {
    // playwright-core is where the registry lives; a pin that drifted from
    // playwright's would ask one version's registry about another's browsers.
    expect(manifest.dependencies["playwright-core"]).toBe(
      manifest.dependencies.playwright,
    );
  });

  it("fetches the headless shell alone, and both builds only with --full", () => {
    expect(installArgv("node", "/pw/cli.js")).toEqual([
      "node",
      "/pw/cli.js",
      "install",
      "--only-shell",
      "chromium",
    ]);
    expect(installArgv("node", "/pw/cli.js", { full: true })).toEqual([
      "node",
      "/pw/cli.js",
      "install",
      "chromium",
    ]);
  });

  it("asks for the system libraries only when told to", () => {
    expect(installArgv("node", "/pw/cli.js", { withDeps: true })).toEqual([
      "node",
      "/pw/cli.js",
      "install",
      "--with-deps",
      "--only-shell",
      "chromium",
    ]);
  });

  it("fetches the full browser without the shell it already has", () => {
    expect(fullBrowserArgv("node", "/pw/cli.js")).toEqual([
      "node",
      "/pw/cli.js",
      "install",
      "--no-shell",
      "chromium",
    ]);
  });

  it("answers for both builds, with a path only where one is installed", () => {
    // Which builds this machine has is the machine's business; the shape of
    // the answer, and that a path named is a real file, are the package's.
    const { shell, full } = browserPaths();
    for (const [name, path] of [
      ["chromium_headless_shell", shell],
      ["chromium", full],
    ] as const) {
      if (path === null) continue;
      expect(existsSync(path)).toBe(true);
      expect(path).toContain(name);
    }
  });
});

describe("a command that opens a window", () => {
  it("launches at once when the full browser is there", async () => {
    const ran: string[][] = [];
    const ok = await ensureFullBrowser({
      has: () => true,
      run: async (command, args) => {
        ran.push([command, ...args]);
        return 0;
      },
      write: () => {},
    });
    expect(ok).toBe(true);
    expect(ran).toEqual([]);
  });

  it("says why, then fetches the full browser once, when it is not", async () => {
    const ran: string[][] = [];
    let said = "";
    const ok = await ensureFullBrowser({
      has: () => false,
      run: async (command, args) => {
        ran.push([command, ...args]);
        return 0;
      },
      write: (text) => (said += text),
    });
    expect(ok).toBe(true);
    expect(ran).toHaveLength(1);
    expect(ran[0].slice(-3)).toEqual(["install", "--no-shell", "chromium"]);
    expect(said).toContain("headless shell");
    expect(said).toContain(pinnedPlaywright().version);
  });

  it("reports a fetch that failed, so the command stops before a window", async () => {
    const ok = await ensureFullBrowser({
      has: () => false,
      run: async () => 1,
      write: () => {},
    });
    expect(ok).toBe(false);
  });
});
