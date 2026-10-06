import { mkdirSync, writeFileSync } from "node:fs";
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
  type Clock,
} from "../../cloud/wait.js";
import { inheritedEnv, loadedFrom } from "../../env.js";
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
    scrubbed.err(`Unknown command "cloud ${name}".\n\n${cloudUsage()}`);
    return 1;
  }
  const extra = (Object.keys(values) as Flag[]).filter(
    (flag) => !command.flags.includes(flag),
  );
  if (extra.length > 0) {
    scrubbed.err(
      `cloud ${name} takes no --${extra.join(", --")}: ${command.usage}\n`,
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
      `${file} sets VERSIONCAM_API${origin ? ` to ${origin}` : ""}, which versioncam cloud ignores: ` +
      "it takes the API's address only from the shell, so that no repository can send a sign-in, or a command holding a token, to a server of its choosing. " +
      "To use another address, set it in the shell: export VERSIONCAM_API=<address>\n"
    );
  }
  return (
    `${file} sets ${name}, which versioncam cloud ignores: ` +
    "it keeps its sign-in where the shell's environment says, so that no repository can choose where a token is written. " +
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
      : `This signs in to ${c.origin}, which VERSIONCAM_API names, rather than ${own}.\n`) +
      "To sign in this command line to version.cam, open this address on any device:\n" +
      `  ${plain(device.verification_uri_complete)}\n` +
      `and approve the code ${plainLine(device.user_code)}. Only approve a code you started yourself.\n` +
      `(Or open ${plain(device.verification_uri)} and enter the code there.)\n` +
      `Waiting for the approval, for up to ${minutes(waitLimit(device.expires_in))}.\n`,
  );

  const outcome = await waitForToken(client, device, c.io.clock);
  if (outcome.kind === "denied") {
    c.io.err(
      "The sign-in was denied on the approval page. Nothing was saved.\n",
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
  c.io.out(
    `Signed in to ${c.origin} as ${plainLine(who)}, until ${when(expires_at, c.io)}.\n` +
      `The token is kept in ${shown(path, c.io)}, readable only by you.\n`,
  );
  return 0;
}

async function logout(c: Context): Promise<number> {
  const credential = readCredential(c.io.env, c.api);
  const path = shown(credentialsPath(c.io.env), c.io);
  if (!credential) {
    c.io.out(`Not signed in to ${c.origin}.\n`);
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
          `${refusal(error)}\nThe token was not revoked, and is still in ${path}: run \`versioncam cloud logout\` again.\n`,
        );
        return 1;
      }
    }
  }
  removeCredential(c.io.env, c.api);
  c.io.out(
    lapsed
      ? `Signed out of ${c.origin}: the sign-in had expired, and is removed from ${path}.\n`
      : `Signed out of ${c.origin}: the token is revoked, and removed from ${path}.\n`,
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
      `Not signed in to ${c.origin}. Run \`versioncam cloud login\` first.\n`,
    );
    return null;
  }
  c.secrets.push(credential.token);
  if (expired(credential, c.io)) {
    c.io.err(
      `The sign-in to ${c.origin} as ${plainLine(credential.login)} expired on ${when(credential.expiresAt, c.io)}. Run \`versioncam cloud login\` to sign in again.\n`,
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
        `"${plainLine(named)}" is not a project: name one as owner/repo.\n`,
      );
      return undefined;
    }
    return project;
  }
  const origin = originRepository(c.io.cwd, c.io.env);
  if (origin) return origin;
  if (optional) return null;
  c.io.err(
    "This directory is not a clone of a GitHub repository, so name the project: --project owner/repo\n",
  );
  return undefined;
}

/** A clip's id as version.cam takes one: a name, never a path. */
const CLIP_ID = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;

function clipOf(c: Context): string | undefined {
  const clip = c.args[0];
  if (!CLIP_ID.test(clip)) {
    c.io.err(
      `"${plainLine(clip)}" is not a clip id: letters, digits, dots, dashes and underscores.\n`,
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
    c.io.err(`Name the project once: ${SUBCOMMANDS.status.usage}\n`);
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
  const answer = await signed.client.project(project);
  c.io.out(c.json ? json(answer) : statusText(answer, c.io));
  return 0;
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
      problem = `The picture could not be saved: ${(error as Error).message}`;
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
  c.io.out(
    `Acknowledged ${clip}, as ${plainLine(acknowledged.by)} on ${when(acknowledged.at, c.io)}.\n` +
      (plays === undefined
        ? ""
        : plays === null
          ? "Nothing plays meanwhile: no version of it has passed yet.\n"
          : `Your pages keep playing the version recorded ${when(plays.recordedAt, c.io)} (${commitOf(plays.commit)}).\n`) +
      `The reminders stop. If it is still broken ${reminder}, version.cam reminds the team once more.\n`,
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
    c.io.err(`"${plainLine(named)}" is not an account's name.\n`);
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
  c.io.out(c.json ? json(answer) : planText(answer, c.io));
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
  const wrong = `cloud set takes one of: ${SETTINGS}.`;

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
        : "A Slack webhook is an https:// address, from Slack's incoming webhooks.";
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
      : `Visibility is public, unlisted or private, not "${plainLine(value)}".`;
  }
  if (setting === "retention") {
    // What the settings form takes: whole days from one, or nothing, which
    // keeps every version the plan allows.
    if (value === "off") return { retentionDays: null };
    return /^\d{1,4}$/.test(value) && Number(value) >= 1
      ? { retentionDays: Number(value) }
      : "Retention is a number of days, from 1 to 9999, or off.";
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
      `To approve it, open this address, signed in as ${plainLine(signed.credential.login)}:\n` +
      `  ${plain(pending.verification_uri_complete)}\n` +
      `and check that the page shows the code ${plainLine(pending.user_code)} and this change.\n` +
      `Nothing changes until it is approved. Waiting, for up to ${minutes(waitLimit(pending.expires_in))}.\n`,
  );

  const outcome = await waitForChange(
    signed.client,
    project,
    pending,
    c.io.clock,
  );
  if (outcome === "applied") {
    c.io.out(
      "Approved, and applied.\n" +
        ("alertEmail" in request && request.alertEmail
          ? "The address is sent a link first, and told nothing until its owner opens it and says yes.\n"
          : ""),
    );
    return 0;
  }
  c.io.err(
    outcome === "denied"
      ? "Denied on the approval page: nothing changed.\n"
      : "Nobody approved the change in time, and it has expired: nothing changed.\n",
  );
  return 1;
}

// --- Words ------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Who can see the clips, in the README's words for each visibility. */
const VISIBILITY: Record<Visibility, string> = {
  public: "public (anyone, and search engines)",
  unlisted: "unlisted (anyone with the address, kept out of search)",
  private: "private (whoever GitHub lets read the repository, signed in)",
};

function statusText(answer: ProjectStatus, io: CloudIo): string {
  const name = plainLine(answer.project);
  const broken = answer.clips.filter((clip) => clip.status === "broken");
  const lines = [
    answer.clips.length === 0
      ? `${name} has no clips yet: they appear when it first publishes.`
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
          "Private clips' addresses are signed for an hour, and open for anyone who has one, so none is shown here: watch the clips from the project's page.",
        ]
      : []),
    `Plan: ${plainLine(answer.plan.title)} (${
      answer.plan.alerts
        ? "version.cam tells the team when a clip breaks"
        : "CI says when a clip breaks; version.cam tells nobody"
    })`,
    // The setting's own name on the dashboard, in `set viewers`'s words.
    `Tell viewers when a clip is broken: ${answer.showBroken ? "on" : "off"}`,
  );
  if (answer.plan.alerts) lines.push(`Alerts: ${alertsText(answer.alerts)}`);
  lines.push(
    `This month: ${count(answer.usage.publishes, "publish", "publishes")}, ` +
      `${round(answer.usage.renderSeconds / 60)} render minutes, ` +
      `${size(answer.usage.storageBytes)} stored`,
    answer.permission === "admin"
      ? "You may change its settings."
      : "You may see it; its administrators change its settings.",
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
    : "plays nothing: no version of it has passed yet";
}

function alertsText(alerts: ProjectStatus["alerts"]): string {
  if (!alerts) return "the repository's administrators see who is told";
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
    `Signed in as ${plainLine(me.login)}. No project named, and this directory is not a clone of a GitHub repository, so here is every project you can see:`,
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
  lines.push("", "versioncam cloud status owner/repo says more about one.");
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
      ? `${id} is broken, and version.cam has no failure for it.\n`
      : `${id} is not broken: its last check on ${project}'s default branch passed.\n`;
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
    lines.push("There is no picture: the run stopped before a page was there.");
  lines.push(`To see it here: npx versioncam record --draft ${id}`);
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
      `${id} has no version to embed yet: none has passed on ${project}'s default branch.\n` +
      `Once one passes, versioncam cloud embed ${id} prints its snippets.\n`
    );
  }
  const snippets: [string, string | null][] = [
    [
      "A player that sizes itself, for a page that runs scripts",
      answer.embed.script,
    ],
    ["An iframe, for a page that does not", answer.embed.iframe],
    ["The video alone", answer.embed.video],
    ["Markdown, for a README", answer.embed.markdown],
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
      `${project}'s clips are private. These snippets play only for people signed in at app.version.cam who may read the repository, so never on a public page.`,
      "The clip's address above and its files', the GIF's included, are signed: each opens for anyone who has it, for an hour. Use them to look, and never put one in a page, a pull request or an issue.",
      "To show the clip on a public page, its clips have to be public or unlisted: versioncam cloud set visibility unlisted",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Why the account is on its plan, which says who can change it. */
const SOURCE: Record<AccountPlan["plan"]["source"], string> = {
  free: "",
  beta: ", during the beta",
  subscription: ", by subscription",
  override: ", set by version.cam",
};

function planText(answer: AccountPlan, io: CloudIo): string {
  const { plan } = answer;
  // Max is Pro for up to ten private projects: its quantity is a ceiling.
  const quantity =
    plan.name !== "free" && typeof plan.quantity === "number"
      ? ` for ${plan.name === "max" ? "up to " : ""}${count(plan.quantity, "private project")}`
      : "";
  const until = plan.until ? `, until ${day(plan.until, io)}` : "";
  const lines = [
    `${plainLine(answer.account)}: ${plainLine(plan.title)}${quantity}${SOURCE[plan.source] ?? ""}${until}.`,
    `Upgrade or change plans: ${plain(answer.upgrade)}`,
    answer.billing
      ? `Billing: ${plain(answer.billing)}`
      : `Billing: for whoever may bill ${plainLine(answer.account)}.`,
  ];
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

/** "5 Oct 2026". */
function day(iso: string, io: CloudIo): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return plainLine(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
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
