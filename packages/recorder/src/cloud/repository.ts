import { execFileSync } from "node:child_process";

/**
 * Which project a command is about, when nobody says: the GitHub repository
 * this directory is a clone of. A project on version.cam is a repository's
 * `owner/repo`, so its `origin` remote names it, from wherever in the clone
 * the command runs.
 */

/** GitHub's own rule for an account: letters, digits and hyphens, at most 39. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** And for a repository: letters, digits, dots, hyphens and underscores, never `.` or `..`. */
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/**
 * GitHub's hosts for git: the site itself, and `ssh.github.com`, which
 * GitHub documents for SSH over port 443 where port 22 is closed.
 */
const GITHUB_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "ssh.github.com",
]);

/** `owner/repo` if `text` is one, else null. */
export function projectName(text: string): string | null {
  const parts = text.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  return OWNER.test(owner) && REPO.test(repo) ? `${owner}/${repo}` : null;
}

/** An account's name as GitHub allows it, else null. */
export function accountName(text: string): string | null {
  return OWNER.test(text) ? text : null;
}

/**
 * The `owner/repo` a GitHub remote points at, from any of the forms GitHub
 * hands out or git accepts for it: `https://github.com/owner/repo.git`, with
 * a user or a token before the host or without the `.git`;
 * `git@github.com:owner/repo.git`; `ssh://git@github.com/owner/repo.git`,
 * with a port or on `ssh.github.com`. Any other host is null: version.cam
 * knows projects on github.com only.
 */
export function githubRepository(remote: string): string | null {
  const url = remote.trim();
  let host: string;
  let path: string;
  // The short SSH form, `user@host:path`, has no scheme, and git reads a
  // colon before any slash as the end of the host.
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(\S+)$/.exec(url);
  if (scp && !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) {
    host = scp[1];
    path = scp[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (
      !["https:", "http:", "ssh:", "git:", "git+ssh:"].includes(parsed.protocol)
    ) {
      return null;
    }
    host = parsed.hostname;
    // Not decoded: no name GitHub allows needs escaping, so an escape in
    // the path is a name it would not allow, and the check below says no.
    path = parsed.pathname;
  }
  if (!GITHUB_HOSTS.has(host.toLowerCase())) return null;
  return projectName(
    path
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/, ""),
  );
}

/**
 * The repository of `git remote get-url origin` in `cwd`, or null: not a
 * clone, no `origin`, no git, or an origin that is not on GitHub. `get-url`
 * rather than the config's raw value, because it applies a `url.insteadOf`
 * rewrite the way a fetch would. `env` is git's environment, the command's
 * own unless a test isolates git from the machine's configuration.
 */
export function originRepository(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  let remote: string;
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  return githubRepository(remote);
}
