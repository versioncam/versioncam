import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { cloudClient } from "../../cloud/client.js";
import { githubRepository } from "../../cloud/repository.js";
import { inheritedEnv } from "../../env.js";
import { findConfigFile, NO_CONFIG } from "../../loader.js";
import { DEFAULT_API } from "../../publish/protocol.js";

/**
 * `versioncam ci`: write the GitHub Actions workflow that checks the clips on
 * every pull request and publishes them on every push to the default branch.
 *
 * It exists because a GitHub repository publishes only from GitHub Actions:
 * version.cam takes GitHub's own token as proof of which repository and
 * commit a run is of, and refuses a project token for a GitHub repository.
 * So the workflow file is the only way from a clip on disk to its permanent
 * link, and before this command nothing wrote it: a stranger who had just
 * rendered a first clip had to find the Action's README and copy it by hand.
 *
 * The template lives here, not in the Action's README, so that there is one
 * copy with a test on it (`test/fixtures/workflow.yml`, byte for byte). The
 * Action's README copies it, by hand, when it changes.
 *
 * After writing, it says what comes next, which depends on whether the
 * repository is public: version.cam hosts public repositories' clips on Free
 * and private ones on Pro. GitHub's public API says which without a token
 * (a 404 is a private repository, or one that is not on GitHub), and nothing
 * of the user's is sent anywhere to find out.
 */

/** What `ci` needs from the world, so a test can hand it another one. */
export type CiIo = {
  cwd: string;
  /** Git's environment, and where VERSIONCAM_API comes from. */
  env: NodeJS.ProcessEnv;
  out(text: string): void;
  err(text: string): void;
  fetch: typeof fetch;
  /** How long GitHub and version.cam each get to answer. */
  timeoutMs?: number;
};

/** The workflow's path from the repository's root. */
const WORKFLOW = join(".github", "workflows", "versioncam.yml");

/** GitHub's public API is rate-limited and sometimes slow; past this, the answer is "unknown". */
const TIMEOUT_MS = 3000;

/** Where version.cam asks for the Versioncam GitHub App to be installed. */
const APP_URL = "https://github.com/apps/versioncam";

export function ci(argv: string[]): Promise<number> {
  return runCi(argv, {
    cwd: process.cwd(),
    // The shell's, never a repository file's: the same rule as `cloud`, so a
    // cloned `.env` cannot point even this one public request elsewhere.
    env: inheritedEnv(),
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    fetch: globalThis.fetch,
  });
}

export async function runCi(argv: string[], io: CiIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      print: { type: "boolean" },
      force: { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
  });

  // The workflow runs versioncam where the config is, so without a config
  // there is nothing for it to run.
  if (findConfigFile(io.cwd) === null) {
    io.err(`No versioncam.config.ts in ${io.cwd}.\n${NO_CONFIG}\n`);
    return 1;
  }

  // Git answers with the real path, and a temporary directory on macOS is
  // under a link (/var is /private/var), so both sides are made real first.
  const here = realpathSync(io.cwd);
  const top = git(io, ["rev-parse", "--show-toplevel"]);
  const root = top === null ? here : realpathSync(resolve(top));
  const branch = defaultBranch(io);
  const lock = lockDirectory(here, root);
  const text = workflow({
    branch,
    app: slashed(relative(root, here)),
    install: slashed(relative(root, lock ?? root)),
  });

  if (values.print === true) {
    io.out(text);
    return 0;
  }

  const target = join(root, WORKFLOW);
  // From the root, where GitHub looks for it, whichever directory this ran in.
  const shown =
    slashed(WORKFLOW) + (root === here ? "" : " at the repository's root");
  if (existsSync(target) && values.force !== true) {
    io.err(
      `${shown} already exists. ` +
        "`npx versioncam ci --print` shows what this command would write, and `--force` replaces the file.\n",
    );
    return 1;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);

  const lines: string[] = [];
  if (top === null) {
    lines.push(
      "This directory is not in a git repository, so the workflow goes here.",
    );
  }
  lines.push(`Wrote ${shown}.`);

  const remote = git(io, ["remote", "get-url", "origin"]);
  const repo = remote === null ? null : githubRepository(remote);
  const seen = repo === null ? "unknown" : await visibility(repo, io);
  const [owner, name] = repo?.split("/") ?? ["<owner>", "<repo>"];

  lines.push(
    `Commit it and push. On the first push to ${branch}, GitHub Actions records your ` +
      `clips and publishes them to version.cam, and this repository's clips get ` +
      `permanent links at clips.version.cam/${owner}/${name}/<clip>. On every pull ` +
      "request, the workflow checks the clips and fails the build when one no " +
      "longer matches the app.",
  );

  if (seen === "private") {
    const beta = await privateBeta(io);
    lines.push(
      "This repository is private. The workflow will still check your clips on every pull request. " +
        (beta
          ? "version.cam hosts clips from private repositories on the Pro plan, which is free during the private beta for the first ten people who ask. " +
            "In this order: run `npx versioncam cloud login` to create your account; " +
            `email ${beta} with the account name it prints; ` +
            `once Pro is on, install the Versioncam GitHub App on this repository at ${APP_URL}, so version.cam knows who may see the clips; ` +
            `then push to ${branch}.`
          : "version.cam hosts clips from private repositories on the Pro plan. " +
            "In this order: run `npx versioncam cloud login` to create your account; " +
            `switch to Pro at https://app.version.cam/upgrade?account=${owner}; ` +
            `then install the Versioncam GitHub App on this repository at ${APP_URL}, so version.cam knows who may see the clips; ` +
            `then push to ${branch}.`),
    );
  } else if (seen === "unknown") {
    if (repo === null) {
      lines.push(
        "There is no GitHub remote named origin here. The workflow runs on GitHub Actions, so it does nothing until the repository is on GitHub.",
      );
    }
    lines.push(
      "If the repository is private, its clips need the Pro plan; `npx versioncam cloud plan` says more once you are signed in.",
    );
  }

  lines.push(
    "If your app needs more than `npm ci` to start, change the install step before you push.",
  );
  if (lock === null) {
    lines.push(
      "There is no package-lock.json here or above it, and `npm ci` needs one. Change the install step to the one your package manager uses.",
    );
  }

  io.out(`${lines.join("\n")}\n`);
  return 0;
}

/**
 * The workflow, from the Action's README. `app` is where versioncam.config.ts
 * is and `install` where `npm ci` runs, both from the repository's root and
 * empty at the root itself. They differ in a workspace, whose lockfile is at
 * the root while the app is below it: `npm ci` there, the Action at the app.
 */
export function workflow({
  branch,
  app,
  install,
}: {
  branch: string;
  app: string;
  install: string;
}): string {
  const cache = install
    ? `\n          cache-dependency-path: ${install}/package-lock.json`
    : "";
  const npmCi = install
    ? `      - run: npm ci\n        working-directory: ${install}\n`
    : "      - run: npm ci\n";
  const at = app ? `\n          working-directory: ${app}` : "";
  const action = app
    ? `      - uses: versioncam/action@v1\n        with:${at}\n`
    : "      - uses: versioncam/action@v1\n";
  const setup =
    "      - uses: actions/checkout@v4\n" +
    "      - uses: actions/setup-node@v4\n" +
    "        with:\n" +
    "          node-version: 22\n" +
    `          cache: npm${cache}\n` +
    npmCi +
    action;
  return (
    "name: Versioncam\n" +
    "\n" +
    "on:\n" +
    "  pull_request:\n" +
    "  push:\n" +
    `    branches: [${branch}]\n` +
    "\n" +
    "jobs:\n" +
    "  # On a pull request: record every clip, and fail with a comment if one broke.\n" +
    "  check:\n" +
    "    if: github.event_name == 'pull_request'\n" +
    "    runs-on: ubuntu-24.04\n" +
    "    permissions:\n" +
    "      contents: read\n" +
    "      pull-requests: write # to comment when a clip breaks\n" +
    "    steps:\n" +
    setup +
    "\n" +
    `  # On ${branch}: record every clip, then publish the recordings to version.cam.\n` +
    "  publish:\n" +
    "    if: github.event_name == 'push'\n" +
    "    runs-on: ubuntu-24.04\n" +
    "    permissions:\n" +
    "      contents: read\n" +
    "      id-token: write # GitHub's token for version.cam, so no secret is stored\n" +
    "    steps:\n" +
    setup +
    "      - uses: versioncam/action@v1\n" +
    "        if: ${{ !cancelled() }} # a clip that broke is published as broken\n" +
    "        with:\n" +
    `          mode: publish${at}\n`
  );
}

/**
 * Public, private or unknown, from GitHub's public API without a token: 200
 * is public; 404 is private, or not on GitHub at all; anything else, a
 * timeout included, is unknown. Never an error: a rate limit (sixty requests
 * an hour per address) must not stop a command whose file is already written.
 */
export async function visibility(
  repo: string,
  io: Pick<CiIo, "fetch" | "timeoutMs">,
): Promise<"public" | "private" | "unknown"> {
  try {
    const response = await io.fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        accept: "application/vnd.github+json",
        // GitHub refuses a request without one.
        "user-agent": "versioncam",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(io.timeoutMs ?? TIMEOUT_MS),
    });
    if (response.status === 200) return "public";
    if (response.status === 404) return "private";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Where to ask for Pro during the private beta, when version.cam says the
 * beta is private, else null. The wording comes from the server so that no
 * installed copy keeps offering a beta after it ends.
 */
async function privateBeta(io: CiIo): Promise<string | null> {
  const api = (io.env.VERSIONCAM_API || DEFAULT_API).replace(/\/+$/, "");
  const timeout = io.timeoutMs ?? TIMEOUT_MS;
  const fetchWithin: typeof fetch = (url, init) =>
    io.fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  try {
    const plans = await cloudClient({ api, fetch: fetchWithin }).plans();
    return askOf(plans?.privateBeta);
  } catch {
    return null;
  }
}

/** The address to ask, from `/v1/plans`'s `privateBeta`, if it is one. */
export function askOf(field: unknown): string | null {
  const ask = (field as { ask?: unknown } | null | undefined)?.ask;
  return typeof ask === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ask)
    ? ask
    : null;
}

/** The default branch, from the remote's HEAD when git knows it, else `main`. */
function defaultBranch(io: CiIo): string {
  const head = git(io, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const branch = head?.replace(/^origin\//, "");
  // A branch name goes into YAML unquoted, so only the names that need no quoting.
  return branch && /^[A-Za-z0-9._/-]+$/.test(branch) ? branch : "main";
}

/** The nearest directory from `dir` up to `root` with a package-lock.json, or null. */
function lockDirectory(dir: string, root: string): string | null {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, "package-lock.json"))) return at;
    if (at === root || dirname(at) === at) return null;
  }
}

/** A path as YAML and GitHub want it, with forward slashes on Windows too. */
function slashed(path: string): string {
  return path.split(sep).join("/");
}

/** Git's trimmed output, or null when git, the repository or the answer is missing. */
function git(io: CiIo, args: string[]): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd: io.cwd,
      env: io.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}
