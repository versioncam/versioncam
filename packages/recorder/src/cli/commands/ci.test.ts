import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { askOf, runCi, workflow } from "./ci.js";

/**
 * `versioncam ci` in a throwaway repository, with GitHub's API and
 * version.cam's price list faked: nothing here touches the network.
 */

const FIXTURES = new URL("../../../test/fixtures/", import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), "utf8");

/** Git with nothing of this machine's configuration, as in repository.test.ts. */
function gitEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    VERSIONCAM_API: "https://api.version.cam",
  };
}

type Answers = {
  /** GitHub's status for the repository, or "throw" for no answer at all. */
  github?: number | "throw";
  /** What `/v1/plans` answers; unset, it is unreachable. */
  plans?: unknown;
};

type Run = { code: number; out: string; err: string; asked: string[] };

/** A repository with a config at `app` (from its root) and a lockfile at `lock`. */
function repository({
  app = "",
  lock = "" as string | null,
  remote = "https://github.com/acme/app.git" as string | null,
  git = true,
} = {}) {
  const home = mkdtempSync(join(tmpdir(), "versioncam-ci-home-"));
  const root = mkdtempSync(join(tmpdir(), "versioncam-ci-"));
  const env = gitEnv(home);
  const cwd = join(root, app);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "versioncam.config.ts"), "export default {};\n");
  if (lock !== null) writeFileSync(join(root, lock, "package-lock.json"), "{}");
  if (git) {
    execFileSync("git", ["init", "-q", root], { env });
    if (remote) {
      execFileSync("git", ["-C", root, "remote", "add", "origin", remote], {
        env,
      });
    }
  }
  return {
    root,
    cwd,
    env,
    async run(argv: string[], answers: Answers = {}): Promise<Run> {
      const out: string[] = [];
      const err: string[] = [];
      const asked: string[] = [];
      const fake = (async (url: string | URL | Request) => {
        const at = String(url);
        asked.push(at);
        if (at.startsWith("https://api.github.com/")) {
          if (answers.github === "throw" || answers.github === undefined) {
            throw new TypeError("fetch failed");
          }
          return new Response("{}", { status: answers.github });
        }
        if (at === "https://api.version.cam/v1/plans" && "plans" in answers) {
          return new Response(JSON.stringify(answers.plans), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new TypeError("fetch failed");
      }) as typeof fetch;
      const code = await runCi(argv, {
        cwd,
        env,
        out: (text) => out.push(text),
        err: (text) => err.push(text),
        fetch: fake,
      });
      return { code, out: out.join(""), err: err.join(""), asked };
    },
  };
}

const WRITTEN = join(".github", "workflows", "versioncam.yml");

const PUBLIC =
  "Wrote .github/workflows/versioncam.yml.\n" +
  "Commit it and push. On the first push to main, GitHub Actions records your clips and publishes them to version.cam, " +
  "and this repository's clips get permanent links at clips.version.cam/acme/app/<clip>. " +
  "On every pull request, the workflow checks the clips and fails the build when one no longer matches the app.\n";
const INSTALL =
  "If your app needs more than `npm ci` to start, change the install step before you push.\n";

describe("versioncam ci", () => {
  it("writes the workflow at the repository's root, byte for byte the template", async () => {
    const repo = repository();
    const { code, out, err } = await repo.run([], { github: 200 });
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(readFileSync(join(repo.root, WRITTEN), "utf8")).toBe(
      fixture("workflow.yml"),
    );
    expect(out).toBe(PUBLIC + INSTALL);
  });

  it("points the Action at a config below the root, and npm ci at the lockfile", async () => {
    // A workspace: the lockfile at the root, the app below it, as in this
    // repository's own example.
    const workspace = repository({ app: "examples/demo-app", lock: "" });
    expect((await workspace.run([], { github: 200 })).code).toBe(0);
    expect(readFileSync(join(workspace.root, WRITTEN), "utf8")).toBe(
      fixture("workflow-nested.yml"),
    );
    expect(existsSync(join(workspace.cwd, ".github"))).toBe(false);

    // An app with a lockfile of its own installs there.
    const own = repository({ app: "web", lock: "web" });
    await own.run([], { github: 200 });
    const text = readFileSync(join(own.root, WRITTEN), "utf8");
    expect(text).toContain(
      "          cache-dependency-path: web/package-lock.json\n" +
        "      - run: npm ci\n" +
        "        working-directory: web\n",
    );
    expect(text).toContain(
      "          mode: publish\n          working-directory: web\n",
    );
  });

  it("leaves a workflow that is there alone, and exits 1", async () => {
    const repo = repository();
    mkdirSync(join(repo.root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo.root, WRITTEN), "mine\n");
    const { code, out, err } = await repo.run([], { github: 200 });
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(
      ".github/workflows/versioncam.yml already exists. " +
        "`npx versioncam ci --print` shows what this command would write, and `--force` replaces the file.\n",
    );
    expect(readFileSync(join(repo.root, WRITTEN), "utf8")).toBe("mine\n");
  });

  it("replaces it with --force", async () => {
    const repo = repository();
    mkdirSync(join(repo.root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo.root, WRITTEN), "mine\n");
    expect((await repo.run(["--force"], { github: 200 })).code).toBe(0);
    expect(readFileSync(join(repo.root, WRITTEN), "utf8")).toBe(
      fixture("workflow.yml"),
    );
  });

  it("prints the workflow with --print, and writes and asks nothing", async () => {
    const repo = repository();
    const { code, out, asked } = await repo.run(["--print"], { github: 200 });
    expect(code).toBe(0);
    expect(out).toBe(fixture("workflow.yml"));
    expect(asked).toEqual([]);
    expect(existsSync(join(repo.root, ".github"))).toBe(false);
  });

  it("uses the remote's default branch when git knows it", async () => {
    const repo = repository();
    execFileSync(
      "git",
      [
        "-C",
        repo.root,
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/trunk",
      ],
      { env: repo.env },
    );
    const { out } = await repo.run(["--print"]);
    expect(out).toBe(
      fixture("workflow.yml")
        .replace("branches: [main]", "branches: [trunk]")
        .replace("# On main:", "# On trunk:"),
    );
  });

  it("asks GitHub without a token, and says how a private repository gets its clips hosted", async () => {
    const repo = repository();
    const beta = await repo.run([], {
      github: 404,
      plans: { plans: [], privateBeta: { ask: "hello@version.cam" } },
    });
    expect(beta.code).toBe(0);
    expect(beta.out).toBe(
      PUBLIC +
        "This repository is private. The workflow will still check your clips on every pull request. " +
        "version.cam hosts clips from private repositories on the Pro plan, which is free during the private beta for the first ten people who ask. " +
        "In this order: run `npx versioncam cloud login` to create your account; " +
        "email hello@version.cam with the account name it prints; " +
        "once Pro is on, install the Versioncam GitHub App on this repository at https://github.com/apps/versioncam, so version.cam knows who may see the clips; " +
        "then push to main.\n" +
        INSTALL,
    );
    expect(beta.asked).toEqual([
      "https://api.github.com/repos/acme/app",
      "https://api.version.cam/v1/plans",
    ]);

    // No beta announced, or no answer: no beta offered.
    for (const plans of [
      { plans: [], privateBeta: null },
      { plans: [] },
      undefined,
    ]) {
      const after = await repository().run(
        [],
        plans === undefined ? { github: 404 } : { github: 404, plans },
      );
      expect(after.out).toBe(
        PUBLIC +
          "This repository is private. The workflow will still check your clips on every pull request. " +
          "version.cam hosts clips from private repositories on the Pro plan. " +
          "In this order: run `npx versioncam cloud login` to create your account; " +
          "switch to Pro at https://app.version.cam/upgrade?account=acme; " +
          "then install the Versioncam GitHub App on this repository at https://github.com/apps/versioncam, so version.cam knows who may see the clips; " +
          "then push to main.\n" +
          INSTALL,
      );
    }
  });

  it("says what it cannot know when GitHub does not answer, or there is no GitHub remote", async () => {
    const unknown =
      "If the repository is private, its clips need the Pro plan; `npx versioncam cloud plan` says more once you are signed in.\n";
    for (const github of [500, 403, "throw"] as const) {
      const { code, out } = await repository().run([], { github });
      expect(code).toBe(0);
      expect(out).toBe(PUBLIC + unknown + INSTALL);
    }

    const elsewhere = repository({ remote: "https://gitlab.com/acme/app.git" });
    const { out, asked } = await elsewhere.run([], { github: 200 });
    expect(asked).toEqual([]);
    expect(out).toBe(
      PUBLIC.replace(
        "clips.version.cam/acme/app/",
        "clips.version.cam/<owner>/<repo>/",
      ) +
        "There is no GitHub remote named origin here. The workflow runs on GitHub Actions, so it does nothing until the repository is on GitHub.\n" +
        unknown +
        INSTALL,
    );
  });

  it("writes into the directory it runs in outside git, and says so", async () => {
    const loose = repository({ git: false });
    const { code, out } = await loose.run([]);
    expect(code).toBe(0);
    expect(out.split("\n")[0]).toBe(
      "This directory is not in a git repository, so the workflow goes here.",
    );
    expect(existsSync(join(loose.cwd, WRITTEN))).toBe(true);
  });

  it("says when there is no lockfile for npm ci", async () => {
    const { out } = await repository({ lock: null }).run([], { github: 200 });
    expect(out.trimEnd().split("\n").at(-1)).toBe(
      "There is no package-lock.json here or above it, and `npm ci` needs one. Change the install step to the one your package manager uses.",
    );
  });

  it("needs a config to point the workflow at", async () => {
    const repo = repository();
    const empty = mkdtempSync(join(tmpdir(), "versioncam-ci-empty-"));
    const err: string[] = [];
    const code = await runCi([], {
      cwd: empty,
      env: repo.env,
      out: () => undefined,
      err: (text) => void err.push(text),
      fetch: globalThis.fetch,
    });
    expect(code).toBe(1);
    expect(err.join("").split("\n")[0]).toBe(
      `No versioncam.config.ts in ${empty}.`,
    );
    expect(existsSync(join(empty, ".github"))).toBe(false);
  });
});

describe("the private beta's address", () => {
  it("is taken only as an email address", () => {
    expect(askOf({ ask: "hello@version.cam" })).toBe("hello@version.cam");
    expect(askOf(null)).toBeNull();
    expect(askOf(undefined)).toBeNull();
    expect(askOf({ ask: "" })).toBeNull();
    expect(askOf({ ask: "run this; rm -rf /" })).toBeNull();
  });
});

describe("the template", () => {
  it("is the fixture at the root, on main", () => {
    expect(workflow({ branch: "main", app: "", install: "" })).toBe(
      fixture("workflow.yml"),
    );
  });
});
