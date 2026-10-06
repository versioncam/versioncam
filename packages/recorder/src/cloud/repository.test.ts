import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountName,
  githubRepository,
  originRepository,
  projectName,
} from "./repository.js";

/**
 * Git with nothing of this machine's configuration: no `insteadOf` of the
 * developer's rewriting the remotes these tests set, and no `GIT_DIR` from a
 * hook pointing every command at this repository.
 */
function isolated(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: mkdtempSync(join(tmpdir(), "versioncam-git-home-")),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/** A clone whose `origin` is `remote`, or a repository with no remote. */
function clone(remote: string | null): { dir: string; env: NodeJS.ProcessEnv } {
  const env = isolated();
  const dir = mkdtempSync(join(tmpdir(), "versioncam-clone-"));
  execFileSync("git", ["init", "-q", dir], { env });
  if (remote) {
    execFileSync("git", ["-C", dir, "remote", "add", "origin", remote], {
      env,
    });
  }
  return { dir, env };
}

describe("the repository a command is about", () => {
  it("comes from every form a GitHub remote takes", () => {
    for (const remote of [
      "https://github.com/acme/app.git",
      "https://github.com/acme/app",
      "https://github.com/acme/app/",
      "https://peter@github.com/acme/app.git",
      "https://x-access-token:not-a-real-token@github.com/acme/app.git",
      "http://github.com/acme/app.git",
      "https://www.github.com/acme/app.git",
      "git@github.com:acme/app.git",
      "git@github.com:acme/app",
      "github.com:acme/app.git",
      "ssh://git@github.com/acme/app.git",
      "ssh://git@github.com:22/acme/app.git",
      "ssh://git@ssh.github.com:443/acme/app.git",
      "git://github.com/acme/app.git",
      "  git@GitHub.com:acme/app.git\n",
    ]) {
      expect(githubRepository(remote), remote).toBe("acme/app");
    }
    expect(githubRepository("git@github.com:acme/app.js.git")).toBe(
      "acme/app.js",
    );
  });

  it("is nobody's for a remote that is not a repository on GitHub", () => {
    for (const remote of [
      "https://gitlab.com/acme/app.git",
      "git@gitlab.com:acme/app.git",
      "https://github.example.com/acme/app.git",
      "https://notgithub.com/acme/app.git",
      "https://github.com/acme",
      "https://github.com/acme/app/tree/main",
      "https://github.com/acme/../app",
      "https://github.com/-acme/app",
      "https://github.com/acme/app%2Fother",
      "file:///home/peter/app",
      "/home/peter/app",
      "../app",
      "",
    ]) {
      expect(githubRepository(remote), remote).toBeNull();
    }
  });

  it("is read from the clone's origin", () => {
    const https = clone("https://github.com/acme/app.git");
    expect(originRepository(https.dir, https.env)).toBe("acme/app");
    const ssh = clone("git@github.com:acme/docs.git");
    expect(originRepository(ssh.dir, ssh.env)).toBe("acme/docs");

    // From a directory deep inside the clone, as from its root.
    const below = join(ssh.dir, "apps", "web");
    mkdirSync(below, { recursive: true });
    expect(originRepository(below, ssh.env)).toBe("acme/docs");
  });

  it("is null without an origin, or outside a clone", () => {
    const bare = clone(null);
    expect(originRepository(bare.dir, bare.env)).toBeNull();
    const nowhere = mkdtempSync(join(tmpdir(), "versioncam-nowhere-"));
    expect(
      originRepository(nowhere, {
        ...isolated(),
        GIT_CEILING_DIRECTORIES: tmpdir(),
      }),
    ).toBeNull();
  });

  it("names a project or an account only as GitHub allows", () => {
    expect(projectName("acme/app")).toBe("acme/app");
    expect(projectName("acme/my_app.v2")).toBe("acme/my_app.v2");
    for (const wrong of [
      "acme",
      "acme/",
      "/app",
      "acme/app/x",
      "acme/..",
      "ac me/app",
    ]) {
      expect(projectName(wrong), wrong).toBeNull();
    }
    expect(accountName("acme-corp")).toBe("acme-corp");
    expect(accountName("acme/app")).toBeNull();
    expect(accountName("-acme")).toBeNull();
  });
});
