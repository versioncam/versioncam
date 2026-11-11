import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
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
 *
 * `--deployed` writes the workflow for an app that doesn't start in a
 * runner: each job waits for the commit's deployment (the pull request's
 * Preview, the push's Production) through the Action's `deployment` input,
 * and records against it. The secrets the config reads are passed to the
 * Action by name, so a bypass secret and a sign-in reach the config in CI.
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
      deployed: { type: "boolean" },
      preview: { type: "string" },
      production: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  // The workflow runs versioncam where the config is, so without a config
  // there is nothing for it to run.
  const configFile = findConfigFile(io.cwd);
  if (configFile === null) {
    io.err(`No versioncam.config.ts in ${io.cwd}.\n${NO_CONFIG}\n`);
    return 1;
  }

  const named = (flag: "preview" | "production"): string | null => {
    const value = values[flag];
    return typeof value === "string" ? value : null;
  };
  if (values.deployed !== true && (named("preview") ?? named("production"))) {
    io.err(
      "`--preview` and `--production` name the deployments that `--deployed` records against. Add `--deployed`.\n",
    );
    return 1;
  }
  let deployed: Deployed | null = null;
  if (values.deployed === true) {
    const preview = named("preview") ?? "Preview";
    const production = named("production") ?? "Production";
    for (const [flag, name] of [
      ["--preview", preview],
      ["--production", production],
    ] as const) {
      // It goes into YAML unquoted, as the branch does.
      if (!ENVIRONMENT.test(name)) {
        io.err(
          `${flag} must be a GitHub environment name: letters, digits, spaces and . _ - only, got ${JSON.stringify(name)}.\n`,
        );
        return 1;
      }
    }
    const config = readFileSync(configFile, "utf8");
    deployed = {
      preview,
      production,
      secrets: secretsRead(config),
      startsApp: /\bwebServer\b/.test(withoutComments(config)),
    };
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
    deployed,
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

  if (deployed) {
    lines.push(
      `On every pull request, the workflow records your clips against the pull request's ${deployed.preview} deployment and fails the build when one no longer matches the app. ` +
        `On every push to ${branch}, it records them against that commit's ${deployed.production} deployment and publishes them to version.cam, ` +
        `where this repository's clips get permanent links at clips.version.cam/${owner}/${name}/<clip>. ` +
        "It doesn't build or start the app: it installs your packages, versioncam among them, and waits for your host to deploy.",
    );
    lines.push("Before you push:");
    if (deployed.secrets.length > 0) {
      lines.push(
        `- Add these repository secrets, which your config reads and the workflow passes to it: ${deployed.secrets.join(", ")}. ` +
          "They go in the repository's Settings, under Secrets and variables, then Actions.",
      );
    }
    lines.push(
      "- Make sure your host creates a GitHub deployment for each commit. " +
        "On Vercel, turn on deployment_status Events in the project's Settings, under Git: new projects start with it off. " +
        `If yours names its environments something other than ${deployed.preview} and ${deployed.production}, ` +
        "run this again with `--preview <name>` and `--production <name>` and `--force`.",
    );
    if (deployed.startsApp) {
      lines.push(
        "- Your config has a `webServer`. In this workflow nothing should start the app: " +
          "have the config leave `webServer` out when `VERSIONCAM_BASE_URL` is set, which the workflow sets to the deployment's address.",
      );
    }
    lines.push("Then commit the workflow and push.");
  } else {
    lines.push(
      `Commit it and push. On the first push to ${branch}, GitHub Actions records your ` +
        `clips and publishes them to version.cam, and this repository's clips get ` +
        `permanent links at clips.version.cam/${owner}/${name}/<clip>. On every pull ` +
        "request, the workflow checks the clips and fails the build when one no " +
        "longer matches the app.",
    );
  }

  if (seen === "private") {
    const beta = await privateBeta(io);
    lines.push(
      "This repository is private. The workflow will still check your clips on every pull request. " +
        (beta
          ? "version.cam hosts clips from private repositories on the Pro plan, which is free for a year for the first ten people who ask. " +
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

  if (!deployed) {
    lines.push(
      "If your app needs more than `npm ci` to start, change the install step before you push.",
    );
  }
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
  deployed = null,
}: {
  branch: string;
  app: string;
  install: string;
  deployed?: Deployed | null;
}): string {
  if (deployed) return deployedWorkflow({ branch, app, install, deployed });
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

/** What `--deployed` adds to the workflow. */
export type Deployed = {
  /** The GitHub deployment environment a pull request records against. */
  preview: string;
  /** The one a push to the default branch records against. */
  production: string;
  /** The secrets the config reads, by name, passed to the Action as env. */
  secrets: string[];
  /** Whether the config's code mentions `webServer`, which this workflow must not start. */
  startsApp: boolean;
};

/** A GitHub environment name that YAML takes unquoted. */
const ENVIRONMENT = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/**
 * Variables the runner or the Action sets, which are never repository
 * secrets: GitHub refuses a secret whose name starts with GITHUB_.
 */
const NOT_SECRETS =
  /^(VERSIONCAM_|GITHUB_|RUNNER_|ACTIONS_)|^(CI|NODE_ENV|HOME|PATH|PWD|TMPDIR|USER)$/;

/**
 * A config's source with its comments taken out, so that a comment is never
 * read as code: one that explains why there is no `webServer`, as the test
 * repository's did, or a `process.env.NAME` left commented out. Strings are
 * copied whole, so the `//` in "http://localhost:3000" isn't taken for a
 * comment. It reads the text and no more: a regular expression that holds a
 * quote can confuse it, which costs a wrong next step, never a wrong
 * workflow.
 */
export function withoutComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        j += source[j] === "\\" ? 2 : 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/**
 * The environment variables a config reads, by name: `process.env.NAME` and
 * `process.env["NAME"]`, outside comments. Read from the file's text, never
 * by running it, so nothing is sent anywhere and nothing has to be set. A
 * name only another module reads is not found, which the printed next steps
 * leave room for.
 */
export function secretsRead(config: string): string[] {
  const names = new Set<string>();
  const code = withoutComments(config);
  const patterns = [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
  ];
  for (const pattern of patterns) {
    for (const [, name] of code.matchAll(pattern)) {
      if (!NOT_SECRETS.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * The workflow for an app recorded where it is deployed.
 *
 * As the plain one, with three differences in each job: `deployments: read`,
 * so the Action can find the commit's deployment (and `statuses: read`, so
 * it can tell a Vercel project that makes none); the Action's
 * `deployment` input; and the config's secrets as env. The pull request job
 * checks out the branch's head, the commit the host built, rather than the
 * merge commit GitHub makes, so the clips are the ones of the code the
 * preview runs.
 */
function deployedWorkflow({
  branch,
  app,
  install,
  deployed,
}: {
  branch: string;
  app: string;
  install: string;
  deployed: Deployed;
}): string {
  const cache = install
    ? `\n          cache-dependency-path: ${install}/package-lock.json`
    : "";
  const npmCi = install
    ? `      - run: npm ci\n        working-directory: ${install}\n`
    : "      - run: npm ci\n";
  const at = app ? `\n          working-directory: ${app}` : "";
  const env =
    deployed.secrets.length > 0
      ? "        env:\n" +
        deployed.secrets
          .map((name) => `          ${name}: \${{ secrets.${name} }}\n`)
          .join("")
      : "";
  const check = (environment: string) =>
    "      - uses: versioncam/action@v1\n" +
    "        with:\n" +
    `          deployment: ${environment}${at}\n` +
    env;
  const setup = (checkout: string) =>
    checkout +
    "      - uses: actions/setup-node@v4\n" +
    "        with:\n" +
    "          node-version: 22\n" +
    `          cache: npm${cache}\n` +
    npmCi;
  return (
    "name: Versioncam\n" +
    "\n" +
    "on:\n" +
    "  pull_request:\n" +
    "  push:\n" +
    `    branches: [${branch}]\n` +
    "\n" +
    "jobs:\n" +
    `  # On a pull request: record every clip against its ${deployed.preview} deployment, and fail with a comment if one broke.\n` +
    "  check:\n" +
    "    if: github.event_name == 'pull_request'\n" +
    "    runs-on: ubuntu-24.04\n" +
    "    permissions:\n" +
    "      contents: read\n" +
    "      deployments: read # to find the pull request's deployment\n" +
    "      statuses: read # to tell you when Vercel deployed but made no GitHub deployment\n" +
    "      pull-requests: write # to comment when a clip breaks\n" +
    "    steps:\n" +
    setup(
      "      - uses: actions/checkout@v4\n" +
        "        with:\n" +
        "          ref: ${{ github.event.pull_request.head.sha }} # the commit your host deployed\n",
    ) +
    check(deployed.preview) +
    "\n" +
    `  # On ${branch}: record every clip against the ${deployed.production} deployment, then publish the recordings to version.cam.\n` +
    "  publish:\n" +
    "    if: github.event_name == 'push'\n" +
    "    runs-on: ubuntu-24.04\n" +
    "    permissions:\n" +
    "      contents: read\n" +
    "      deployments: read # to find the commit's deployment\n" +
    "      statuses: read # to tell you when Vercel deployed but made no GitHub deployment\n" +
    "      id-token: write # GitHub's token for version.cam, so no secret is stored\n" +
    "    steps:\n" +
    setup("      - uses: actions/checkout@v4\n") +
    check(deployed.production) +
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
  return defaultBranchIn(io.cwd, io.env);
}

/** The same for any directory: `cloud status` names it too. */
export function defaultBranchIn(cwd: string, env: NodeJS.ProcessEnv): string {
  const head = git({ cwd, env }, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
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
function git(io: Pick<CiIo, "cwd" | "env">, args: string[]): string | null {
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
