import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  browserPaths,
  ensureFullBrowser,
  fallbackPlatform,
  fullBrowserArgv,
  installArgv,
  pinnedPlaywright,
  runWithFallback,
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
        return { code: 0, output: "" };
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
        return { code: 0, output: "" };
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
      run: async () => ({ code: 1, output: "" }),
      write: () => {},
    });
    expect(ok).toBe(false);
  });
});

describe("an OS Playwright does not know", () => {
  // What Playwright 1.59 printed on GitHub's ubuntu-latest, Ubuntu 26.04
  // since October 2026, for the browser as for the system libraries.
  const refusal =
    "Error: ERROR: Playwright does not support chromium-headless-shell on ubuntu26.04-x64";

  it("names 24.04 for a newer Ubuntu, same architecture, and nothing else", () => {
    expect(fallbackPlatform(refusal)).toBe("ubuntu24.04-x64");
    expect(fallbackPlatform(refusal.replace("x64", "arm64"))).toBe(
      "ubuntu24.04-arm64",
    );
    expect(fallbackPlatform(refusal.replace("26.04", "24.10"))).toBe(
      "ubuntu24.04-x64",
    );
    // An older Ubuntu it refused is refused for another reason.
    expect(fallbackPlatform(refusal.replace("26.04", "18.04"))).toBeNull();
    // A distribution it never knew has no stand-in known to work.
    expect(
      fallbackPlatform(refusal.replace("ubuntu26.04", "debian13")),
    ).toBeNull();
    expect(fallbackPlatform("E: Unable to locate package libx11-6")).toBeNull();
  });

  it("runs the installer again as that platform, and says so first", async () => {
    const runs: { args: string[]; env?: Record<string, string> }[] = [];
    let said = "";
    const code = await runWithFallback("node", ["cli.js", "install"], {
      run: async (_command, args, env) => {
        runs.push({ args, env });
        return runs.length === 1
          ? { code: 1, output: refusal }
          : { code: 0, output: "" };
      },
      write: (text) => (said += text),
    });
    expect(code).toBe(0);
    expect(runs).toHaveLength(2);
    expect(runs[1].env).toEqual({
      PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: "ubuntu24.04-x64",
    });
    expect(said).toContain("does not know this OS yet");
    expect(said).toContain(
      "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 node cli.js install",
    );
  });

  it("leaves any other failure as it was, after one run", async () => {
    let runs = 0;
    let said = "";
    const code = await runWithFallback("node", ["cli.js", "install"], {
      run: async () => {
        runs += 1;
        return {
          code: 100,
          output: "E: Could not get lock /var/lib/dpkg/lock",
        };
      },
      write: (text) => (said += text),
    });
    expect(code).toBe(100);
    expect(runs).toBe(1);
    expect(said).toBe("");
  });

  it("does not second-guess an override the person set", async () => {
    process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = "ubuntu22.04-x64";
    try {
      let runs = 0;
      const code = await runWithFallback("node", ["cli.js", "install"], {
        run: async () => {
          runs += 1;
          return { code: 1, output: refusal };
        },
        write: () => {},
      });
      expect(code).toBe(1);
      expect(runs).toBe(1);
    } finally {
      delete process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;
    }
  });
});
