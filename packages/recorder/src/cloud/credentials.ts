import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Where `versioncam cloud login` keeps what it was given, and nothing else.
 *
 * The token speaks for a person on version.cam for seven days, so it lives
 * where a person's credentials live and nowhere near a repository: never in
 * the working directory, where a `git add` or an agent's copy could take it
 * along. The directory is the owner's alone and the file is the owner's to
 * read, as an SSH key's would be. The commands read it; nothing prints it.
 */

/** One sign-in. */
export type Credential = {
  token: string;
  /** The GitHub login it signs in as. */
  login: string;
  /** When the token stops working, as the service said. */
  expiresAt: string;
};

/**
 * `$XDG_CONFIG_HOME/versioncam/credentials.json`, else
 * `~/.config/versioncam/credentials.json`. A relative `XDG_CONFIG_HOME` is
 * ignored, as the XDG specification says it must be: it would put the token
 * wherever the command happened to run.
 */
export function credentialsPath(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME;
  const config =
    xdg && isAbsolute(xdg) ? xdg : join(env.HOME || homedir(), ".config");
  return join(config, "versioncam", "credentials.json");
}

/**
 * The key a sign-in is kept under: the API's origin. Staging and production
 * sit side by side, and `VERSIONCAM_API` chooses between them without
 * signing out of the other.
 */
export function apiOrigin(api: string): string {
  return new URL(api).origin;
}

export function readCredential(
  env: NodeJS.ProcessEnv,
  api: string,
): Credential | null {
  return readAll(credentialsPath(env))[apiOrigin(api)] ?? null;
}

/** Keep a sign-in, replacing this API's last one. Returns the file's path. */
export function saveCredential(
  env: NodeJS.ProcessEnv,
  api: string,
  credential: Credential,
): string {
  const path = credentialsPath(env);
  const all = readAll(path);
  all[apiOrigin(api)] = credential;
  writeAll(path, all);
  return path;
}

/** Forget this API's sign-in; the file goes when nothing is left in it. */
export function removeCredential(env: NodeJS.ProcessEnv, api: string): boolean {
  const path = credentialsPath(env);
  const all = readAll(path);
  const origin = apiOrigin(api);
  if (!(origin in all)) return false;
  delete all[origin];
  writeAll(path, all);
  return true;
}

/**
 * Every sign-in in the file. One that cannot be read counts as none: it
 * could not sign anything in, and signing in again writes a good one over
 * it rather than refusing until someone finds the file by hand.
 */
function readAll(path: string): Record<string, Credential> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const all: Record<string, Credential> = {};
  for (const [origin, value] of Object.entries(parsed)) {
    // Only what this file writes, an origin a key: anything else, such as
    // a `__proto__` key, is not a sign-in and must not become a property.
    if (!isOrigin(origin)) continue;
    const entry = value as Partial<Credential> | null;
    if (
      typeof entry?.token === "string" &&
      typeof entry.login === "string" &&
      typeof entry.expiresAt === "string"
    ) {
      all[origin] = {
        token: entry.token,
        login: entry.login,
        expiresAt: entry.expiresAt,
      };
    }
  }
  return all;
}

function isOrigin(key: string): boolean {
  try {
    return new URL(key).origin === key;
  } catch {
    return false;
  }
}

/**
 * Write the file whole, through a file beside it that is created 0600 and
 * renamed over it: no moment exists at which the token is in a file anyone
 * else may read, or in half a file. The modes are set again after creating,
 * because a directory that was already there keeps the mode it had, and a
 * file's creation mode is only what the umask lets through.
 */
function writeAll(path: string, all: Record<string, Credential>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (Object.keys(all).length === 0) {
    rmSync(path, { force: true });
    return;
  }
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}
