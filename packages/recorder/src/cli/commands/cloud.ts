import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  CloudError,
  cloudClient,
  type CloudClient,
} from "../../cloud/client.js";
import {
  apiOrigin,
  credentialsPath,
  readCredential,
  removeCredential,
  saveCredential,
  type Credential,
} from "../../cloud/credentials.js";
import type {
  AccountPlan,
  ChangeRequest,
  ClipDetail,
  ClipStatus,
  Me,
  Plays,
  ProjectStatus,
  Visibility,
} from "../../cloud/protocol.js";
import {
  accountName,
  originRepository,
  projectName,
} from "../../cloud/repository.js";
import {
  realClock,
  waitForChange,
  waitForToken,
  waitLimit,
  type ChangeOutcome,
  type Clock,
} from "../../cloud/wait.js";
import { inheritedEnv, loadedFrom } from "../../env.js";
import { askOf, defaultBranchIn } from "./ci.js";
import { DEFAULT_API } from "../../publish/protocol.js";
import { USAGE } from "../usage.js";

/**
 * `versioncam cloud`: what the dashboard at app.version.cam does, from a
 * terminal, and so from an agent's shell.
 *
 * `versioncam login` was already taken, by the command that saves the app's
 * own browser session for recording, so the platform's commands live under
 * a name of their own.
 *
 * A person signs in once, with a code they approve in a browser, and the
 * commands then read for them: a project's clips and whether each is
 * broken, why one broke, how to embed one, the plan. Acknowledging a broken
 * clip needs no more than that, as on the dashboard. Every setting change
 * prints a code and waits for the person to approve that one change in the
 * browser, because whoever runs these commands may be an agent, and what an
 * agent reads here (clip titles, failure messages) was written by whoever
 * published. Nothing it is told can change a project without a person seeing
 * the change.
 *
 * The token never reaches the output, whatever the service says: every line
 * written passes through a filter that knows it.
 *
 * And the commands run in the environment the shell gave, never with what
 * the repository's `.env.recording` or `.env` added, which the CLI loads
 * before every command. Those files come with whatever was cloned: one that
 * set VERSIONCAM_API could send a sign-in, and every command holding a
 * token, to a server of the repository's choosing, and one that set
 * XDG_CONFIG_HOME could have the token written into the repository itself.
 * `publish` still reads the files: CI sets its environment itself.
 */

/** A variable a file set that these commands read only from the shell. */
export type Ignored = { name: string; file: string; value: string };

/** What a cloud command needs from the world, so a test can hand it another one. */
export type CloudIo = {
  /** The shell's environment, never a repository file's. */
  env: NodeJS.ProcessEnv;
  /** What a file tried to set, said once so that nobody wonders why it did nothing. */
  ignored?: Ignored[];
  /** The directory the command runs in: its repository, and its `.versioncam/`. */
  cwd: string;
  out(text: string): void;
  err(text: string): void;
  fetch: typeof fetch;
  clock: Clock;
  hostname(): string;
  /** The zone dates are written in: the machine's own, unless a test pins one. */
  timeZone?: string;
};

/**
 * What these commands read from the environment that a file could
 * otherwise set: where the API is, and where the sign-in is kept.
 */
const SHELL_ONLY = ["VERSIONCAM_API", "XDG_CONFIG_HOME"];

/** The environment a cloud command runs in, and what the files tried to add to it. */
export function shellEnvironment(): Pick<CloudIo, "env" | "ignored"> {
  return {
    env: inheritedEnv(),
    ignored: SHELL_ONLY.flatMap((name) => {
      const file = loadedFrom(name);
      return file ? [{ name, file, value: process.env[name] ?? "" }] : [];
    }),
  };
}

export function cloud(argv: string[]): Promise<number> {
  return runCloud(argv, {
    ...shellEnvironment(),
    cwd: process.cwd(),
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    fetch: globalThis.fetch,
    clock: realClock,
    hostname,
  });
}

type Flag = "json" | "project" | "label";

type Context = {
  io: CloudIo;
  /** The API's address, without a trailing slash. */
  api: string;
  /** The key its sign-in is kept under. */
  origin: string;
  /** What the command was given after its name. */
  args: string[];
  json: boolean;
  project: string | undefined;
  label: string | undefined;
  /** Tokens this run has held: the output never shows one. */
  secrets: string[];
};

type Subcommand = {
  usage: string;
  flags: Flag[];
  /** How many arguments it takes after its name, at least and at most. */
  args: [number, number];
  run(context: Context): Promise<number>;
};

const SUBCOMMANDS: Record<string, Subcommand> = {
  login: {
    usage: "versioncam cloud login [--label <name>]",
    flags: ["label"],
    args: [0, 0],
    run: login,
  },
  logout: {
    usage: "versioncam cloud logout",
    flags: [],
    args: [0, 0],
    run: logout,
  },
  status: {
    usage: "versioncam cloud status [owner/repo] [--json]",
    flags: ["json", "project"],
    args: [0, 1],
    run: status,
  },
  failure: {
    usage: "versioncam cloud failure <clip> [--project owner/repo] [--json]",
    flags: ["json", "project"],
    args: [1, 1],
    run: failure,
  },
  ack: {
    usage: "versioncam cloud ack <clip> [--project owner/repo]",
    flags: ["project"],
    args: [1, 1],
    run: ack,
  },
  embed: {
    usage: "versioncam cloud embed <clip> [--project owner/repo] [--json]",
    flags: ["json", "project"],
    args: [1, 1],
    run: embed,
  },
  set: {
    usage: "versioncam cloud set <setting> <value> [--project owner/repo]",
    flags: ["project"],
    args: [2, 3],
    run: set,
  },
  plan: {
    usage: "versioncam cloud plan [account] [--json]",
    flags: ["json"],
    args: [0, 1],
    run: plan,
  },
};

export async function runCloud(argv: string[], io: CloudIo): Promise<number> {
  const secrets: string[] = [];
  const scrubbed = scrubbing(io, secrets);

  let parsed: ReturnType<typeof parseCloudArgs>;
  try {
    parsed = parseCloudArgs(argv);
  } catch (error) {
    // Strict, unlike the recording commands: a misspelt `--project` on a
    // command that changes a setting must not quietly mean this directory's.
    scrubbed.err(`${(error as Error).message}\n\n${cloudUsage()}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [name, ...args] = positionals;
  if (!name) {
    scrubbed.out(cloudUsage());
    return 1;
  }
  // Its own names only: `constructor` is on every object, and no command.
  const command = Object.hasOwn(SUBCOMMANDS, name) ? SUBCOMMANDS[name] : null;
  if (!command) {
    scrubbed.err(
      `Unknown command "cloud ${name}". These are the cloud commands:\n\n${cloudUsage()}`,
    );
    return 1;
  }
  const extra = (Object.keys(values) as Flag[]).filter(
    (flag) => !command.flags.includes(flag),
  );
  if (extra.length > 0) {
    scrubbed.err(
      `\`cloud ${name}\` has no option --${extra.join(", --")}. Usage: ${command.usage}\n`,
    );
    return 1;
  }
  const [least, most] = command.args;
  if (args.length < least || args.length > most) {
    scrubbed.err(`Usage: ${command.usage}\n`);
    return 1;
  }

  // Before anything is sent, so that whoever put the value in the file
  // knows at once why it changed nothing. On stderr, out of `--json`'s way.
  for (const each of io.ignored ?? []) scrubbed.err(ignoredText(each));

  const api = (io.env.VERSIONCAM_API || DEFAULT_API).replace(/\/+$/, "");
  let origin: string;
  try {
    origin = apiOrigin(api);
    if (!/^https?:$/.test(new URL(api).protocol)) throw new Error();
  } catch {
    scrubbed.err(`VERSIONCAM_API is not a web address: ${plain(api)}\n`);
    return 1;
  }

  try {
    return await command.run({
      io: scrubbed,
      api,
      origin,
      args,
      json: values.json === true,
      project: values.project,
      label: values.label,
      secrets,
    });
  } catch (error) {
    scrubbed.err(`${refusal(error)}\n`);
    return 1;
  }
}

function parseCloudArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      json: { type: "boolean" },
      project: { type: "string" },
      label: { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });
}

/**
 * Why a file's value did nothing, and how to set it for real. The value is
 * the repository's, so it is never offered back as a command to paste: an
 * address is shown only as the origin it parses to, which cannot carry
 * anything a shell would run, and a path not at all.
 */
function ignoredText({ name, file, value }: Ignored): string {
  if (name === "VERSIONCAM_API") {
    let origin: string | null = null;
    try {
      const url = new URL(value);
      if (/^https?:$/.test(url.protocol)) origin = url.origin;
    } catch {
      // Not an address: said without it.
    }
    return (
      `${file} sets VERSIONCAM_API${origin ? ` to ${origin}` : ""}, but versioncam cloud ignores it. ` +
      "It reads the API's address only from the shell, so that no repository can send your sign-in, or a request that carries your token, to a server it chose. " +
      "To use another address, set it in the shell: export VERSIONCAM_API=<address>\n"
    );
  }
  return (
    `${file} sets ${name}, but versioncam cloud ignores it. ` +
    "It keeps its sign-in where the shell's environment says, so that no repository can choose where your token is written. " +
    `To keep it elsewhere, set ${name} in the shell.\n`
  );
}

/** The `Manage` lines of the usage text, which are this command's. */
function cloudUsage(): string {
  const group = USAGE.split("\n\n").find((block) =>
    block.startsWith("Manage\n"),
  );
  return `${group ?? "versioncam cloud <command>"}\n`;
}

/** The output, with every token this run has held taken out of it. */
function scrubbing(io: CloudIo, secrets: string[]): CloudIo {
  const scrub = (text: string) =>
    secrets.reduce(
      (written, secret) =>
        secret ? written.split(secret).join("[token]") : written,
      text,
    );
  return {
    ...io,
    out: (text) => io.out(scrub(text)),
    err: (text) => io.err(scrub(text)),
  };
}

/** A refusal in words: the service's sentence, and what it carried with it. */
function refusal(error: unknown): string {
  if (!(error instanceof CloudError)) return (error as Error)?.message ?? "";
  const lines = [plain(error.message)];
  if (error.code === "plan" && error.upgrade) {
    lines.push(`Upgrade: ${plain(error.upgrade)}`);
  }
  if (error.code === "rate_limited" && error.retryAfter !== null) {
    lines.push(`Try again in ${error.retryAfter} seconds.`);
  }
  return lines.join("\n");
}

// --- Signing in --------------------------------------------------------------

/** The longest label the approval page shows. */
const LABEL_MAX = 60;

async function login(c: Context): Promise<number> {
  const label = plainLine(c.label ?? c.io.hostname()).trim();
  if (
    c.label !== undefined &&
    (label.length === 0 || label.length > LABEL_MAX)
  ) {
    c.io.err(`--label takes a name of 1 to ${LABEL_MAX} characters.\n`);
    return 1;
  }
  const client = cloudClient({ api: c.api, fetch: c.io.fetch });
  const device = await client.device(label.slice(0, LABEL_MAX) || null);
  // Said before the code, while it can still change the person's mind. No
  // repository file can set VERSIONCAM_API for these commands, but a shell
  // still can, a script's or an agent's included, and a service in the
  // middle could pass on a real code and keep the token it buys.
  const own = apiOrigin(DEFAULT_API);
  c.io.out(
    (c.origin === own
      ? ""
      : `This signs in to ${c.origin}, which VERSIONCAM_API names, instead of ${own}.\n`) +
      "To sign in to version.cam from this command line, open this link on any device:\n" +
      `  ${plain(device.verification_uri_complete)}\n` +
      `Then approve the code ${plainLine(device.user_code)}. Only approve a code you started yourself.\n` +
      `(Or open ${plain(device.verification_uri)} and enter the code there.)\n` +
      `Waiting up to ${minutes(waitLimit(device.expires_in))} for your approval.\n`,
  );

  const outcome = await waitForToken(client, device, c.io.clock);
  if (outcome.kind === "denied") {
    c.io.err(
      "Someone denied the sign-in on the approval page, so nothing was saved.\n",
    );
    return 1;
  }
  if (outcome.kind === "expired" || outcome.kind === "timeout") {
    c.io.err(
      `Nobody approved the code in time, and it has expired. Run \`versioncam cloud login\` again for a new one.\n`,
    );
    return 1;
  }

  const { token, login: who, expires_at } = outcome.token;
  c.secrets.push(token);
  const before = readCredential(c.io.env, c.api);
  const path = saveCredential(c.io.env, c.api, {
    token,
    login: who,
    expiresAt: expires_at,
  });
  // The sign-in it replaces would otherwise stay good for the rest of its
  // seven days, held by nothing: revoked, and quietly, since the new one is
  // saved whatever the answer.
  if (before && before.token !== token) {
    c.secrets.push(before.token);
    await cloudClient({ api: c.api, token: before.token, fetch: c.io.fetch })
      .revoke()
      .catch(() => undefined);
  }
  // On Windows `chmod` sets the read-only bit and nothing else, so the file is as
  // private as the folder it sits in, which this did not decide and cannot vouch for.
  const private_ = process.platform === "win32" ? "" : ", readable only by you";
  c.io.out(
    `Signed in to ${c.origin} as ${plainLine(who)} until ${when(expires_at, c.io)}.\n` +
      `Your token is saved in ${shown(path, c.io)}${private_}.\n`,
  );
  // The one moment everyone who will ever use version.cam reads this
  // command's output, so the offer is made here rather than only on the
  // upgrade page, which a person who stays in a terminal never opens.
  const ask = await privateBeta(c);
  if (ask) {
    c.io.out(
      "version.cam is in private beta, so you can't buy a plan yet. " +
        "If you'd like Pro for free during the beta (private repositories, unlimited history, and alerts when a clip breaks), " +
        `email ${ask} and mention your account name, ${plainLine(who)}. ` +
        "The first ten people who ask get it.\n",
    );
  }
  return 0;
}

/**
 * Where to ask for Pro while the beta is private, as version.cam's price
 * list says, or null: not private, an older service without the field, or
 * no answer. Never an error, since it only adds a sentence.
 */
async function privateBeta(c: Context): Promise<string | null> {
  try {
    const plans = await cloudClient({ api: c.api, fetch: c.io.fetch }).plans();
    return askOf(plans?.privateBeta);
  } catch {
    return null;
  }
}

async function logout(c: Context): Promise<number> {
  const credential = readCredential(c.io.env, c.api);
  const path = shown(credentialsPath(c.io.env), c.io);
  if (!credential) {
    c.io.out(`You're not signed in to ${c.origin}.\n`);
    return 0;
  }
  c.secrets.push(credential.token);
  const lapsed = expired(credential, c.io);
  if (!lapsed) {
    try {
      await signedClient(c, credential).revoke();
    } catch (error) {
      // Unauthorized is the service saying the token is already no good,
      // which is what signing out wants. Anything else may have left it
      // good, so it stays on disk for a second try.
      if (!(error instanceof CloudError) || error.status !== 401) {
        c.io.err(
          `${refusal(error)}\nThe token wasn't revoked and is still in ${path}. Run \`versioncam cloud logout\` again.\n`,
        );
        return 1;
      }
    }
  }
  removeCredential(c.io.env, c.api);
  c.io.out(
    lapsed
      ? `Signed out of ${c.origin}. The sign-in had already expired, and it is removed from ${path}.\n`
      : `Signed out of ${c.origin}. The token is revoked and removed from ${path}.\n`,
  );
  return 0;
}

/**
 * This API's sign-in, or null once the person has been told how to get one.
 * A token past its own expiry is not sent: the answer is known.
 */
function signIn(
  c: Context,
): { credential: Credential; client: CloudClient } | null {
  const credential = readCredential(c.io.env, c.api);
  if (!credential) {
    c.io.err(
      `You're not signed in to ${c.origin}. Run \`versioncam cloud login\` first.\n`,
    );
    return null;
  }
  c.secrets.push(credential.token);
  if (expired(credential, c.io)) {
    c.io.err(
      `Your sign-in to ${c.origin} as ${plainLine(credential.login)} expired on ${when(credential.expiresAt, c.io)}. Run \`versioncam cloud login\` to sign in again.\n`,
    );
    return null;
  }
  return { credential, client: signedClient(c, credential) };
}

function signedClient(c: Context, credential: Credential): CloudClient {
  return cloudClient({
    api: c.api,
    token: credential.token,
    fetch: c.io.fetch,
  });
}

function expired(credential: Credential, io: CloudIo): boolean {
  const at = Date.parse(credential.expiresAt);
  return Number.isFinite(at) && at <= io.clock.now();
}

// --- Which project ----------------------------------------------------------

/**
 * The project a command is about: the one named, else the GitHub repository
 * this directory is a clone of. Undefined, after saying why, when neither
 * gives one; null for `status` alone, which then lists every project.
 */
function projectOf(
  c: Context,
  named: string | undefined,
  optional = false,
): string | null | undefined {
  if (named !== undefined) {
    const project = projectName(named);
    if (!project) {
      c.io.err(
        `"${plainLine(named)}" is not a project. Name the project as owner/repo.\n`,
      );
      return undefined;
    }
    return project;
  }
  const origin = originRepository(c.io.cwd, c.io.env);
  if (origin) return origin;
  if (optional) return null;
  c.io.err(
    "This directory isn't a clone of a GitHub repository, so name the project with --project owner/repo.\n",
  );
  return undefined;
}

/** A clip's id as version.cam takes one: a name, never a path. */
const CLIP_ID = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;

function clipOf(c: Context): string | undefined {
  const clip = c.args[0];
  if (!CLIP_ID.test(clip)) {
    c.io.err(
      `"${plainLine(clip)}" is not a clip id. A clip id has only letters, digits, dots, dashes and underscores.\n`,
    );
    return undefined;
  }
  return clip;
}

// --- Reading ----------------------------------------------------------------

async function status(c: Context): Promise<number> {
  if (
    c.args[0] !== undefined &&
    c.project !== undefined &&
    c.args[0] !== c.project
  ) {
    c.io.err(
      `You named two different projects. Name one: ${SUBCOMMANDS.status.usage}\n`,
    );
    return 1;
  }
  const project = projectOf(c, c.args[0] ?? c.project, true);
  if (project === undefined) return 1;
  const signed = signIn(c);
  if (!signed) return 1;

  if (project === null) {
    const me = await signed.client.me();
    c.io.out(c.json ? json(me) : meText(me));
    return 0;
  }
  let answer: ProjectStatus;
  try {
    answer = await signed.client.project(project);
  } catch (error) {
    // The API answers one 404 for a project that is not there and for one
    // this person may not see. The first is what a new repository hits, and
    // what it needs is the next step, so that comes first.
    if (error instanceof CloudError && error.status === 404) {
      const own = originRepository(c.io.cwd, c.io.env) === project;
      c.io.err(notThereText(project, own ? ownRepository(c) : null));
      return 1;
    }
    throw error;
  }
  c.io.out(c.json ? json(answer) : statusText(answer, c.io));
  return 0;
}

/** For the repository this directory is a clone of: its default branch, and whether the workflow is there. */
function ownRepository(c: Context): { branch: string; workflow: boolean } {
  let root = c.io.cwd;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: c.io.cwd,
      env: c.io.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a clone after all: the directory it runs in.
  }
  return {
    branch: defaultBranchIn(c.io.cwd, c.io.env),
    workflow: existsSync(join(root, ".github", "workflows", "versioncam.yml")),
  };
}

/**
 * What to do about a project version.cam does not have. For this
 * directory's own repository it can say whether the workflow is written;
 * for one named on the command line it cannot.
 */
function notThereText(
  project: string,
  own: { branch: string; workflow: boolean } | null,
): string {
  const branch = own?.branch ?? "main";
  const lines = [
    `${plainLine(project)} isn't on version.cam yet. It appears after the workflow in .github/workflows/versioncam.yml runs on ${branch} for the first time.` +
      (own === null
        ? ""
        : own.workflow
          ? ` Push to ${branch}, or check the Actions tab if you already have.`
          : " If there is no workflow yet, `npx versioncam ci` writes one."),
    "If it has published already and you still see this, sign in again at https://app.version.cam: version.cam checks which repositories you can read when you sign in there.",
  ];
  return `${lines.join("\n")}\n`;
}

async function failure(c: Context): Promise<number> {
  const clip = clipOf(c);
  if (clip === undefined) return 1;
  const project = projectOf(c, c.project);
  if (!project) return 1;
  const signed = signIn(c);
  if (!signed) return 1;

  const answer = await signed.client.clip(project, clip);
  let saved: string | null = null;
  let problem: string | null = null;
  if (answer.failure?.picture) {
    try {
      saved = await savePicture(c, answer.failure.picture, clip);
    } catch (error) {
      problem = `versioncam couldn't save the picture: ${(error as Error).message}`;
    }
  }
  c.io.out(
    c.json
      ? json({ ...answer, savedPicture: saved })
      : failureText(project, answer, saved, c.io),
  );
  if (problem) {
    c.io.err(`${problem}\n`);
    return 1;
  }
  return 0;
}

/**
 * The page as the failing run left it, into `.versioncam/failures/`, which
 * every repository set up for versioncam already keeps out of git. Fetched
 * without the token: a private project's picture comes signed for an hour
 * and needs nothing more, and the token goes to the API and nowhere else.
 */
async function savePicture(
  c: Context,
  address: string,
  clip: string,
): Promise<string> {
  const { io } = c;
  // An address without a host is the API's.
  const url = new URL(address, `${c.api}/`);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("its address is not a web address");
  }
  const response = await io.fetch(url);
  if (!response.ok) throw new Error(`its address answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dir = join(io.cwd, ".versioncam", "failures");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${clip}.png`);
  writeFileSync(path, bytes);
  return relative(io.cwd, path);
}

async function ack(c: Context): Promise<number> {
  const clip = clipOf(c);
  if (clip === undefined) return 1;
  const project = projectOf(c, c.project);
  if (!project) return 1;
  const signed = signIn(c);
  if (!signed) return 1;

  const { acknowledged } = await signed.client.ack(project, clip);
  // Whoever said it first is who it stays said by, and the service answers
  // with theirs: someone else's means it was said already, not just now.
  // GitHub's logins are the same name in any case.
  const already =
    acknowledged.by.toLowerCase() !== signed.credential.login.toLowerCase();
  // What keeps playing is the project's answer, not the acknowledgment's,
  // and an acknowledgment that went through is worth saying without it.
  let plays: Plays | null | undefined;
  try {
    const answer = await signed.client.project(project);
    plays = answer.clips.find((each) => each.clip === clip)?.plays ?? null;
  } catch {
    plays = undefined;
  }
  // The service's rule: one more reminder thirty days after the
  // acknowledgment, if the clip is still broken then.
  const at = Date.parse(acknowledged.at);
  const reminder = Number.isFinite(at)
    ? `on ${day(new Date(at + 30 * DAY_MS).toISOString(), c.io)}`
    : "in thirty days";
  const who = `${plainLine(acknowledged.by)} on ${when(acknowledged.at, c.io)}`;
  c.io.out(
    (already
      ? `${clip} was already acknowledged by ${who}.\n`
      : `Acknowledged ${clip} as ${who}.\n`) +
      (plays === undefined
        ? ""
        : plays === null
          ? "Nothing plays in the meantime, because no version of it has passed yet.\n"
          : `Your pages keep playing the version recorded ${when(plays.recordedAt, c.io)} (${commitOf(plays.commit)}).\n`) +
      `${already ? "The reminders stopped then" : "The reminders stop now"}. If it is still broken ${reminder}, version.cam reminds the team once more.\n`,
  );
  return 0;
}

async function embed(c: Context): Promise<number> {
  const clip = clipOf(c);
  if (clip === undefined) return 1;
  const project = projectOf(c, c.project);
  if (!project) return 1;
  const signed = signIn(c);
  if (!signed) return 1;

  if (c.json) {
    c.io.out(json(await signed.client.clip(project, clip)));
    return 0;
  }
  // The project for its visibility: a private clip's snippets play for
  // nobody on a public page, which is the one thing about them worth
  // saying before anyone pastes one.
  const [answer, status] = await Promise.all([
    signed.client.clip(project, clip),
    signed.client.project(project),
  ]);
  c.io.out(embedText(answer, status.visibility, project));
  return 0;
}

async function plan(c: Context): Promise<number> {
  const named = c.args[0];
  if (named !== undefined && !accountName(named)) {
    c.io.err(`"${plainLine(named)}" is not an account name.\n`);
    return 1;
  }
  const signed = signIn(c);
  if (!signed) return 1;
  // This repository's owner, whose plan its project is on; outside a
  // clone, the person's own account.
  const account =
    named ??
    originRepository(c.io.cwd, c.io.env)?.split("/")[0] ??
    signed.credential.login;
  const answer = await signed.client.plan(account);
  if (c.json) {
    c.io.out(json(answer));
    return 0;
  }
  c.io.out(planText(answer, await privateBeta(c), c.io));
  return 0;
}

// --- Changing a setting -------------------------------------------------------

const SETTINGS =
  "visibility <public|unlisted|private>, retention <days|off>, viewers <on|off>, " +
  "alerts email <address|off>, alerts slack <address|off>, alerts issues <on|off>";

/** The setting and value as the API takes them, or why not. */
export function changeRequest(args: string[]): ChangeRequest | string {
  const [setting, ...rest] = args;
  const onOff = (value: string | undefined) =>
    value === "on" ? true : value === "off" ? false : null;
  const wrong = `cloud set takes one of these settings: ${SETTINGS}.`;

  if (setting === "alerts") {
    const [kind, value, ...more] = rest;
    if (value === undefined || more.length > 0) return wrong;
    if (kind === "email") {
      if (value === "off") return { alertEmail: null };
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? { alertEmail: value }
        : `"${plainLine(value)}" is not an email address.`;
    }
    if (kind === "slack") {
      if (value === "off") return { slackWebhook: null };
      // Only its shape: the service says which hooks it takes. And the
      // address is never repeated back, since anyone who has it can post.
      return /^https:\/\/\S+$/.test(value)
        ? { slackWebhook: value }
        : "A Slack webhook address starts with https://. You get one from Slack's incoming webhooks.";
    }
    if (kind === "issues") {
      const issues = onOff(value);
      return issues === null ? wrong : { staleIssues: issues };
    }
    return wrong;
  }

  const [value, ...more] = rest;
  if (value === undefined || more.length > 0) return wrong;
  if (setting === "visibility") {
    return ["public", "unlisted", "private"].includes(value)
      ? { visibility: value as Visibility }
      : `Visibility must be public, unlisted or private, not "${plainLine(value)}".`;
  }
  if (setting === "retention") {
    // What the settings form takes: whole days from one, or nothing, which
    // keeps every version the plan allows.
    if (value === "off") return { retentionDays: null };
    return /^\d{1,4}$/.test(value) && Number(value) >= 1
      ? { retentionDays: Number(value) }
      : "Retention must be a number of days from 1 to 9999, or off.";
  }
  if (setting === "viewers") {
    const viewers = onOff(value);
    return viewers === null ? wrong : { showBroken: viewers };
  }
  return wrong;
}

async function set(c: Context): Promise<number> {
  const request = changeRequest(c.args);
  if (typeof request === "string") {
    c.io.err(`${request}\n`);
    return 1;
  }
  const project = projectOf(c, c.project);
  if (!project) return 1;
  const signed = signIn(c);
  if (!signed) return 1;

  const pending = await signed.client.change(project, request);
  c.io.out(
    `${plain(pending.describe)}\n\n` +
      `To approve it, open this link while signed in as ${plainLine(signed.credential.login)}:\n` +
      `  ${plain(pending.verification_uri_complete)}\n` +
      `Then check that the page shows the code ${plainLine(pending.user_code)} and this change.\n` +
      `Nothing changes until you approve it. Waiting up to ${minutes(waitLimit(pending.expires_in))}.\n`,
  );

  let outcome: ChangeOutcome;
  try {
    outcome = await waitForChange(signed.client, project, pending, c.io.clock);
  } catch (error) {
    // The change was asked for, and its person may have approved it while
    // the service could not say so: whether it applied is the settings'
    // to tell, not this command's to guess.
    c.io.err(
      `${refusal(error)}\nTo see whether the change was approved in the meantime, check the project's settings on app.version.cam.\n`,
    );
    return 1;
  }
  if (outcome === "applied") {
    c.io.out(
      "Approved and applied.\n" +
        ("alertEmail" in request && request.alertEmail
          ? "version.cam first sends that address a link, and sends it nothing else until its owner opens the link and agrees.\n"
          : ""),
    );
    return 0;
  }
  c.io.err(
    outcome === "denied"
      ? "Someone denied the change on the approval page, so nothing changed.\n"
      : "Nobody approved the change in time, so it expired and nothing changed.\n",
  );
  return 1;
}

// --- Words ------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Who can see the clips, in the README's words for each visibility. */
const VISIBILITY: Record<Visibility, string> = {
  public: "public (anyone, and search engines)",
  unlisted: "unlisted (anyone with the address, kept out of search)",
  private: "private (signed-in people who can read the repository on GitHub)",
};

function statusText(answer: ProjectStatus, io: CloudIo): string {
  const name = plainLine(answer.project);
  const broken = answer.clips.filter((clip) => clip.status === "broken");
  const lines = [
    answer.clips.length === 0
      ? `${name} has no clips yet. They appear when it publishes for the first time.`
      : `${name}: ${count(answer.clips.length, "clip")}, ${broken.length} broken.`,
  ];
  if (answer.clips.length > 0) lines.push("");
  // A private project's clip addresses are signed, and open for anyone who
  // has one, for an hour. Listed as a clip's address, one would be pasted
  // into a page, or a pull request, and leak the clip; so they are not.
  const signed = answer.visibility === "private";
  const ids = answer.clips.map((clip) => plainLine(clip.clip));
  const width = Math.max(0, ...ids.map((id) => id.length));
  const pad = " ".repeat(width + 4);
  answer.clips.forEach((clip, i) => {
    lines.push(`  ${ids[i].padEnd(width)}  ${clipState(clip, answer, io)}`);
    lines.push(`${pad}${playsText(clip.plays, io)}`);
    if (!signed) lines.push(`${pad}${plainLine(clip.url)}`);
  });
  lines.push(
    "",
    `Visibility: ${VISIBILITY[answer.visibility] ?? plainLine(answer.visibility)}`,
    ...(signed && answer.clips.length > 0
      ? [
          "Private clips have signed links that work for anyone who has them, for an hour, so they aren't shown here. Watch the clips from the project's page.",
        ]
      : []),
    `Plan: ${plainLine(answer.plan.title)} (${
      answer.plan.alerts
        ? "version.cam sends alerts when a clip breaks"
        : "CI reports a broken clip, and version.cam sends no alerts"
    })`,
    // The setting's own name on the dashboard, in `set viewers`'s words.
    `Tell viewers when a clip is broken: ${answer.showBroken ? "on" : "off"}`,
  );
  // Only when the service says so: an older one sends no field, and then
  // nothing is known either way.
  if (answer.appInstalled === false) {
    lines.push(
      `The Versioncam GitHub App isn't installed on this repository. Install it at ${APP_URL}. It lets version.cam know who can see a private repository's clips, and it adds a check to each commit.`,
    );
  }
  if (answer.plan.alerts) lines.push(`Alerts: ${alertsText(answer.alerts)}`);
  lines.push(
    `This month: ${count(answer.usage.publishes, "publish", "publishes")}, ` +
      `${round(answer.usage.renderSeconds / 60)} render minutes, ` +
      `${size(answer.usage.storageBytes)} stored`,
    answer.permission === "admin"
      ? "You can change its settings."
      : "You can see it, but only its administrators can change its settings.",
    `Manage it: ${plain(answer.manage)}`,
  );
  return `${lines.join("\n")}\n`;
}

function clipState(
  clip: ClipStatus,
  answer: ProjectStatus,
  io: CloudIo,
): string {
  if (clip.status !== "broken") {
    return clip.checkedAt
      ? `current, checked ${when(clip.checkedAt, io)}`
      : "current";
  }
  const since = clip.brokenSince ? ` since ${when(clip.brokenSince, io)}` : "";
  if (clip.acknowledged) {
    return `broken${since}; acknowledged by ${plainLine(clip.acknowledged.by)} on ${when(clip.acknowledged.at, io)}`;
  }
  // Free has nothing to acknowledge: nobody is reminded.
  return `broken${since}${answer.plan.alerts ? "; not acknowledged" : ""}`;
}

function playsText(plays: Plays | null, io: CloudIo): string {
  return plays
    ? `plays the version recorded ${when(plays.recordedAt, io)} (${commitOf(plays.commit)})`
    : "plays nothing, because no version of it has passed yet";
}

function alertsText(alerts: ProjectStatus["alerts"]): string {
  if (!alerts)
    return "only the repository's administrators can see who gets alerts";
  const told = [
    alerts.email
      ? `email to ${plainLine(alerts.email)}${alerts.emailConfirmed ? "" : " (waiting for its owner to confirm it)"}`
      : null,
    alerts.slack ? "Slack" : null,
    alerts.issues ? "GitHub issues" : null,
  ].filter((each): each is string => each !== null);
  return told.length > 0 ? told.join(", ") : "none";
}

function meText(me: Me): string {
  const lines = [
    `Signed in as ${plainLine(me.login)}. You didn't name a project, and this directory isn't a clone of a GitHub repository, so here are all the projects you can see:`,
  ];
  for (const account of me.accounts) {
    // No plan is an account whose plan the dashboard would not show this
    // person either: named, and nothing said of its plan.
    lines.push(
      "",
      `${plainLine(account.login)}${account.plan ? `, on ${plainLine(account.plan.title)}` : ""}`,
    );
    const names = account.projects.map((p) => plainLine(p.project));
    const width = Math.max(0, ...names.map((name) => name.length));
    account.projects.forEach((project, i) => {
      lines.push(
        `  ${names[i].padEnd(width)}  ${plainLine(project.visibility)}, ${count(project.clips, "clip")}` +
          (project.broken > 0 ? `, ${project.broken} broken` : ""),
      );
    });
    if (account.projects.length === 0) lines.push("  no projects yet");
  }
  if (me.accounts.length === 0) lines.push("", "No projects yet.");
  lines.push(
    "",
    "Run versioncam cloud status owner/repo to see more about one of them.",
  );
  return `${lines.join("\n")}\n`;
}

function failureText(
  project: string,
  answer: ClipDetail,
  saved: string | null,
  io: CloudIo,
): string {
  const failure = answer.failure;
  const id = plainLine(answer.clip);
  if (!failure) {
    return answer.status === "broken"
      ? `${id} is broken, but version.cam has no failure record for it.\n`
      : `${id} isn't broken. Its last check on ${project}'s default branch passed.\n`;
  }
  const lines = [
    `${id} broke on ${when(failure.since, io)}, at ${commitOf(failure.commit)}.`,
    failure.step
      ? `It stopped at step ${failure.step.index}, ${plainLine(failure.step.call)}:`
      : "It stopped before its first step:",
    ...plain(failure.message)
      .split("\n")
      .map((line) => `  ${line}`),
  ];
  if (saved) lines.push(`The page when it stopped: ${saved}`);
  else if (!failure.picture)
    lines.push(
      "There is no picture, because the run stopped before a page loaded.",
    );
  lines.push(
    `To see it on this machine, run: npx versioncam record --draft ${id}`,
  );
  return `${lines.join("\n")}\n`;
}

function embedText(
  answer: ClipDetail,
  visibility: Visibility,
  project: string,
): string {
  // Nothing of the clip has passed on the default branch yet, so its page
  // has nothing to play, and there is nothing to embed: a plain answer,
  // not a failure, since nothing is wrong with asking.
  if (!answer.embed) {
    const id = plainLine(answer.clip);
    return (
      `${id} has no version to embed yet, because none has passed on ${project}'s default branch.\n` +
      `Once one passes, versioncam cloud embed ${id} prints its snippets.\n`
    );
  }
  const snippets: [string, string | null][] = [
    [
      "A player that sizes itself, for a page that runs scripts",
      answer.embed.script,
    ],
    ["An iframe, for a page that does not", answer.embed.iframe],
    // React compiles MDX and refuses the iframe's style as a string, so
    // Docusaurus fails its build on the line above.
    [
      "The iframe as JSX, for MDX on Docusaurus, Nextra or Fumadocs",
      answer.embed.jsx ?? null,
    ],
    ["The video alone", answer.embed.video],
    ["Markdown, for a README", answer.embed.markdown],
    // GitBook takes no iframe, so its block comes from our integration,
    // which plays a pasted link; Git Sync writes the block as this tag.
    [
      "For GitBook, install https://app.gitbook.com/integrations/versioncam and paste the clip's link, or write this in a repository synced with Git Sync",
      answer.embed.gitbook ?? null,
    ],
  ];
  const lines = [`${plainLine(answer.clip)}, at ${plainLine(answer.url)}`];
  for (const [what, snippet] of snippets) {
    if (snippet) lines.push("", `${what}:`, plain(snippet));
  }
  const files = Object.entries(answer.files ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (files.length > 0) {
    const width = Math.max(...files.map(([kind]) => kind.length));
    lines.push("", "Files:");
    for (const [kind, url] of files)
      lines.push(`  ${kind.padEnd(width)}  ${plain(url)}`);
  }
  // The snippets play the unsigned living address, which opens only for
  // whoever may read the repository; every address in the answer itself,
  // the clip's own and the GIF's among the files', is signed instead, and
  // opens for anyone who has it until the hour is up.
  if (visibility === "private") {
    lines.push(
      "",
      `${project}'s clips are private. These snippets play only for people who are signed in at app.version.cam and can read the repository, so they won't play on a public page.`,
      "The clip's link above and the links to its files, the GIF included, are signed. Each one works for anyone who has it, for an hour. Use them to look at the clip, but never put one in a page, a pull request or an issue.",
      "To show the clip on a public page, make the project's clips public or unlisted: versioncam cloud set visibility unlisted",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Where version.cam asks for the Versioncam GitHub App to be installed. */
const APP_URL = "https://github.com/apps/versioncam";

/**
 * What each plan opens, in a sentence: a person who has just been given Pro
 * learns here that a private repository needs the App, and how to turn on
 * alerts. The numbers are the service's limits (its plans table); a plan
 * this does not know gets no sentence rather than a wrong one.
 */
const INCLUDES: Record<string, string> = {
  free:
    "Free covers public repositories: up to three projects, ten clips each, thirty days of history, clips up to sixty seconds, 1 GB. " +
    "Checks on pull requests and the badge are included.",
  pro:
    `Pro includes private repositories (install the Versioncam GitHub App on each one: ${APP_URL}), unlimited history, up to a hundred clips per project, ` +
    "and alerts by email, Slack or GitHub issue, which you turn on with `npx versioncam cloud set alerts` or on the project's page.",
  max:
    `Max includes private repositories, for up to ten private projects (install the Versioncam GitHub App on each one: ${APP_URL}), unlimited history, up to a hundred clips per project, ` +
    "and alerts by email, Slack or GitHub issue, which you turn on with `npx versioncam cloud set alerts` or on the project's page.",
};

function planText(
  answer: AccountPlan,
  ask: string | null,
  io: CloudIo,
): string {
  const { plan } = answer;
  const account = plainLine(answer.account);
  // The private projects the plan covers, as the service counts them: Pro
  // as many as it pays for (ten in the beta or when version.cam sets it),
  // and null for any number. Free covers none and Max's sentence says its
  // ten, so neither repeats it here.
  const quantity =
    plan.name === "free" || plan.name === "max"
      ? ""
      : plan.quantity === null
        ? " for any number of private projects"
        : typeof plan.quantity === "number"
          ? ` for ${count(plan.quantity, "private project")}`
          : "";
  const until = plan.until ? ` until ${day(plan.until, io, "long")}` : "";
  // Why the account is on its plan, which says who can change it. Pro set
  // by version.cam while the beta is private is the beta's grant.
  const source =
    plan.source === "beta"
      ? ", free during the beta"
      : plan.source === "subscription"
        ? ", paid by subscription"
        : plan.source === "override"
          ? ask && plan.name === "pro"
            ? ", free during the private beta"
            : ", set by version.cam"
          : "";
  const lines = [
    `${account} is on ${plainLine(plan.title)}${quantity}${until}${source}.`,
  ];
  const includes = Object.hasOwn(INCLUDES, plan.name)
    ? INCLUDES[plan.name]
    : null;
  if (includes) lines.push(includes);
  if (plan.name === "free" && ask) {
    lines.push(
      "",
      "Pro is free during the private beta for the first ten people who ask. " +
        `To ask, send this to ${ask} from the address GitHub has for you:`,
      `  Subject: Pro for ${account} during the beta`,
      `  Please switch on Pro for my account ${account}.`,
      "",
    );
  }
  lines.push(
    `Upgrade or change plans: ${plain(answer.upgrade)}`,
    answer.billing
      ? `Billing: ${plain(answer.billing)}`
      : `Only people who can bill ${account} see its billing page.`,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * What came from the service, safe to write to a terminal. Clip titles and
 * failure messages are written by whoever published, and a control
 * character in one could rewrite the screen it is printed on, or reverse
 * the text around it. Newlines and tabs stay.
 */
function plain(text: string): string {
  return (
    String(text)
      // A terminal's escape sequences whole, colours and cursor moves, so
      // that a message from a test runner that colours its errors reads as
      // words rather than as `[31m`.
      .replace(/(?![\n\t])\p{Cc}\[[0-?]*[ -/]*[@-~]/gu, "")
      // Then every other control character but those two, and the marks
      // that set the direction text runs in.
      .replace(/(?![\n\t])[\p{Cc}\p{Bidi_Control}]/gu, "")
  );
}

/** The same, on one line. */
function plainLine(text: string): string {
  return plain(text).replace(/[\n\t]+/g, " ");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** "5 Oct 2026, 14:02", in the machine's own time zone. */
function when(iso: string, io: CloudIo): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return plainLine(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: io.timeZone,
  }).format(date);
}

/** "5 Oct 2026", or with `long`, "5 October 2026". */
function day(
  iso: string,
  io: CloudIo,
  month: "short" | "long" = "short",
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return plainLine(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month,
    year: "numeric",
    timeZone: io.timeZone,
  }).format(date);
}

function minutes(ms: number): string {
  return count(Math.round(ms / 60000), "minute");
}

function commitOf(commit: string): string {
  return plainLine(commit).slice(0, 7);
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function round(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function size(bytes: number): string {
  if (bytes >= 1e9) return `${round(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} kB`;
}

/** A path as a person would type it: under `~` when it is in the home directory. */
function shown(path: string, io: CloudIo): string {
  const home = io.env.HOME;
  if (home && (path === home || path.startsWith(`${home}${sep}`))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}
