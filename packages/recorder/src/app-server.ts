import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { ResolvedConfig, ResolvedWebServer } from "./config.js";
import { inheritedEnv } from "./env.js";

/**
 * Starting the app a clip records — and, the half that matters, stopping it.
 *
 * Every command that drives the app runs inside `withApp`, so `record`,
 * `check`, `inspect` and the rest work from a cold shell, and an agent in a
 * repository it has never seen does not have to be told how to start the dev
 * server, or remember to stop it. The semantics are Playwright's `webServer`
 * wherever Playwright has an opinion: poll first, reuse what answers unless
 * told not to, start the command otherwise, wait for it to answer.
 *
 * The one place this goes further is the stopping. The command runs as the
 * leader of its own process group, and every way out of the command that
 * started it — a normal return, a thrown error, Ctrl-C, a SIGTERM from
 * whatever ran us — signals the whole group, not just the shell at its top.
 * A recorder that leaves dev servers behind after a failed clip is the kind
 * of thing that makes people stop using a tool.
 *
 * Windows has no process groups to signal and no SIGTERM to send, so there the
 * same promise is kept another way: taskkill takes the command's whole process
 * tree at once. Playwright does the same with its browsers, and its `webServer`
 * says outright that graceful shutdown is not supported on Windows.
 */

export type AppHandle = {
  /** True when this process started the app; false when it found it up. */
  started: boolean;
  /** One line for a person: what was found or done, and the HTTP status. */
  detail: string;
  /**
   * Stop what was started. Resolves once the whole process group is gone, or
   * on Windows the whole process tree.
   */
  stop(): Promise<void>;
};

const WINDOWS = process.platform === "win32";

/** What taskkill exits with for a pid it cannot find. */
const TASKKILL_NOT_FOUND = 128;

export type Probe =
  { up: true; status: number } | { up: false; reason: string };

/** How much of a failed start's output an error message carries. */
const TAIL_LINES = 40;

/** How long a start may be silent before saying what it is waiting for. */
const SAY_WAITING_AFTER_MS = 15_000;

/**
 * Between SIGTERM and SIGKILL. A dev server that has not exited five seconds
 * after being asked is not going to, and one that is still flushing a database
 * to disk needs more than the instant a SIGKILL gives it.
 */
const GRACE_MS = 5_000;

/**
 * Whether an answer means the app is ready for a clip.
 *
 * Below 500, as Playwright's `webServer` has it, including a 401 and a redirect,
 * which is how an app behind a sign-in answers, and it records perfectly well
 * once `auth` is configured. A 5xx is a server that is up and cannot serve yet:
 * Nuxt's dev server answers 503 while it compiles, with a page that reloads
 * itself when it is done, and a clip opened on that dies in the reload.
 */
function isReady(status: number): boolean {
  return status < 500;
}

/**
 * One request, and any HTTP answer at all counts as something being there.
 *
 * Only silence means nothing is. `redirect: "manual"`, so the answer is the
 * app's own and not wherever a redirect happens to land. Whether what is there
 * is ready is `isReady`'s to say.
 */
export async function probe(
  url: string,
  timeoutMs = 5_000,
  headers: Record<string, string> = {},
): Promise<Probe> {
  try {
    const response = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // The body is irrelevant; cancelling it hands the socket back.
    await response.body?.cancel();
    return { up: true, status: response.status };
  } catch (error) {
    return { up: false, reason: whyNot(error, timeoutMs) };
  }
}

/**
 * The part of a failed fetch worth printing.
 *
 * `fetch` says "fetch failed" about everything; what went wrong is on its
 * `cause` — `ECONNREFUSED`, `ENOTFOUND` — and that is the word a person
 * recognises.
 */
function whyNot(error: unknown, timeoutMs: number): string {
  const e = error as {
    name?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  if (e.name === "TimeoutError")
    return `no answer within ${seconds(timeoutMs)}`;
  return e.cause?.code || e.cause?.message || e.message || String(error);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The port a URL is served on, for a message a person can act on. */
function portOf(url: string): string {
  const u = new URL(url);
  return u.port || (u.protocol === "https:" ? "443" : "80");
}

/**
 * Make sure the app answers, starting it if the config says how.
 *
 * With no `webServer` in the config this does nothing, and every command
 * behaves as it always has: the app is the person's to run. Otherwise it
 * polls first, because a server that is already up — a developer's own `npm
 * run dev` — is the common case and restarting it would be rude. Up and not
 * reusable is a refusal rather than a restart: whatever is serving that port
 * is not ours to replace.
 */
export async function ensureApp(config: ResolvedConfig): Promise<AppHandle> {
  const server = config.webServer;
  if (!server) {
    return {
      started: false,
      detail: "no webServer in the config",
      stop: async () => {},
    };
  }

  const found = await probe(server.url);
  if (found.up) {
    if (!server.reuseExistingServer) {
      throw new Error(
        `Something is already serving ${server.url} (port ${portOf(server.url)}), ` +
          `and webServer.reuseExistingServer is false` +
          (process.env.CI ? " (the default when CI is set)" : "") +
          ", so versioncam won't replace it. Stop it, or set webServer.reuseExistingServer to true.",
      );
    }
    const status = isReady(found.status)
      ? found.status
      : await untilReady(server, found.status);
    return {
      started: false,
      detail: `already serving at ${server.url} (HTTP ${status})`,
      stop: async () => {},
    };
  }

  return start(server, config.outDir);
}

/**
 * Wait for a server someone else started to finish starting.
 *
 * Their `npm run dev`, still compiling in another terminal. A server that stays
 * at a 5xx is an app that is failing, and a clip of its error page helps nobody.
 */
async function untilReady(
  server: ResolvedWebServer,
  first: number,
): Promise<number> {
  announceNotReady(server, first);
  const deadline = Date.now() + server.timeoutMs;
  let status = first;
  while (Date.now() < deadline) {
    await sleep(500);
    const answer = await probe(server.url);
    if (answer.up) {
      if (isReady(answer.status)) return answer.status;
      status = answer.status;
    }
  }
  throw new Error(
    `${server.url} answered HTTP ${status} for ${seconds(server.timeoutMs)}, ` +
      "and a 5xx means the server can't serve pages yet, so nothing was recorded. " +
      "Open the address to see what it says, or point webServer.url at a page " +
      "that answers once the app is ready.",
  );
}

/**
 * One line, because this wait can take minutes and looks like a hang otherwise.
 * On stderr, as `drivingApp`'s line is: stdout belongs to the command.
 */
function announceNotReady(server: ResolvedWebServer, status: number): void {
  process.stderr.write(
    `app: ${server.url} answers HTTP ${status}, so it isn't ready yet. ` +
      `Waiting up to ${seconds(server.timeoutMs)}.\n`,
  );
}

/**
 * `ensureApp`, run `fn`, and stop whatever was started, however `fn` ends.
 *
 * A server that was already up is left exactly as it was found.
 */
export async function withApp<T>(
  config: ResolvedConfig,
  fn: (app: AppHandle) => Promise<T>,
): Promise<T> {
  const app = await ensureApp(config);
  try {
    return await fn(app);
  } finally {
    await app.stop();
  }
}

/** A line reader that keeps only the last `TAIL_LINES` lines it was fed. */
function tailOf(stream: Readable, tail: string[]): void {
  let partial = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    // Either line ending: what Windows programs print would otherwise carry a
    // carriage return into the error message, which overwrites its own line.
    const lines = (partial + chunk).split(/\r?\n/);
    partial = lines.pop() ?? "";
    tail.push(...lines);
    if (tail.length > TAIL_LINES) tail.splice(0, tail.length - TAIL_LINES);
  });
  stream.on("end", () => {
    if (partial) tail.push(partial.replace(/\r$/, ""));
  });
}

async function start(
  server: ResolvedWebServer,
  outDir: string,
): Promise<AppHandle> {
  mkdirSync(outDir, { recursive: true });
  const logFile = join(outDir, "webserver.log");
  const log = createWriteStream(logFile, { flags: "a" });
  log.write(
    `\n--- ${new Date().toISOString()}  ${server.command}  (in ${server.cwd})\n`,
  );

  const began = Date.now();
  // `detached` makes the shell the leader of a new process group, so one
  // signal to the group reaches everything the command started — `npm run
  // dev`'s Vite, `make start`'s three services — and not only the shell. It
  // also takes the group out of the terminal's, so a Ctrl-C meant for us does
  // not reach the server before we have decided what to do about it.
  //
  // On Windows `detached` makes no group, only a console window of its own, so
  // the command stays attached and hidden, and `killTree` is what stops it.
  //
  // The environment is the shell's, not this process's: what the recorder
  // loaded from `.env.recording` for its own sign-in stays with the recorder.
  const child = spawn(server.command, {
    shell: true,
    cwd: server.cwd,
    env: { ...inheritedEnv(), ...server.env },
    detached: !WINDOWS,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Listened to for the life of the child, not once: a second "error" with no
  // listener would take this whole process down with it.
  const spawnError = new Promise<Error>((resolve) =>
    child.on("error", resolve),
  );
  if (child.pid === undefined) {
    // Spawning itself failed — a `cwd` that does not exist, most likely — and
    // the reason arrives as an event, not a return value.
    const error = await spawnError;
    log.end();
    throw new Error(
      `webServer could not start "${server.command}" in ${server.cwd}: ${error.message}`,
    );
  }
  const pid = child.pid;

  const tail: string[] = [];
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  tailOf(child.stdout, tail);
  tailOf(child.stderr, tail);

  // Asserted rather than annotated, or TypeScript narrows it to `null` for
  // good: it cannot see the assignment inside the callback below.
  let exit = null as { code: number | null; signal: string | null } | null;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      resolve();
    }),
  );

  // Every way out. A signal handler sends SIGTERM to the group *first*, and
  // synchronously, because whatever else is listening may exit the process
  // before an async stop gets anywhere: Playwright's own SIGINT handler closes
  // its browsers and calls `process.exit(130)`. The `exit` handler is the last
  // resort for the same reason — it cannot wait, but it can still ask.
  //
  // On Windows the first thing is the only thing: taskkill, which is synchronous
  // and works from all three. Once, because a second one would find nothing and
  // log "already exited" about a server the first has just killed. And not at
  // all once the shell has exited, because Windows hands pids out again and the
  // number may be somebody else's by now.
  let treeOutcome: string | null = null;
  const stopTree = (): string =>
    (treeOutcome ??= exit ? "stopped: it had already exited" : killTree(pid));
  let stopped = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (WINDOWS) stopTree();
    else signalGroup(pid, "SIGTERM");
    void stop().finally(() =>
      process.exit(128 + (constants.signals[signal] ?? 0)),
    );
  };
  const onExit = () => {
    if (stopped) return;
    if (WINDOWS) stopTree();
    else signalGroup(pid, "SIGTERM");
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, onSignal);
  process.on("exit", onExit);

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      let outcome: string;
      if (WINDOWS) {
        outcome = stopTree();
        // Lets Node reap the shell, and read the last of what it printed.
        await within(exited, 2_000);
      } else {
        outcome = await stopGroup(pid, exited);
      }
      stopped = true;
      for (const signal of signals) process.off(signal, onSignal);
      process.off("exit", onExit);
      // A descendant that left the group — something that daemonises — can
      // still hold the pipes open, and an open pipe keeps this process alive
      // after its work is done. Whatever it is, it is no longer ours to read.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      log.write(`--- ${outcome}\n`);
      // Whether the group is gone is a question about processes. Whether the
      // app is gone is a question about the port, and it is the one the next
      // command will trip over — a container, say, that the start command
      // handed the work to and that no signal to the group reaches.
      let after = await probe(server.url, 1_000);
      if (after.up && WINDOWS) {
        // taskkill returns once the processes are told, and a socket can outlive
        // that by a moment. A server that is really there is there a second on.
        await sleep(1_000);
        after = await probe(server.url, 1_000);
      }
      if (after.up) {
        const warning =
          `webServer: stopped "${server.command}", but ${server.url} still ` +
          `answers. Something it started is outside its process ${WINDOWS ? "tree" : "group"} ` +
          "and is still running.";
        log.write(`--- ${warning}\n`);
        process.stderr.write(`${warning}\n`);
      }
      // Flushed before this resolves, so whoever reads the log next — a person
      // after a failed start, a test — reads all of it.
      await new Promise<void>((resolve) => log.end(resolve));
    })());

  const fail = async (why: string): Promise<never> => {
    await stop();
    // The exit can land a moment before the last of the output does.
    await within(new Promise((resolve) => child.once("close", resolve)), 250);
    const output = tail.length
      ? `\nIts last ${tail.length} lines of output (the full output is in ${logFile}):\n` +
        tail.map((line) => `  ${line}`).join("\n")
      : `\nIt printed nothing (${logFile}).`;
    throw new Error(`${why}${output}`);
  };

  const deadline = began + server.timeoutMs;
  let lastStatus = null as number | null;
  let waitingSaid = false;
  // Playwright's cadence, short at first because most dev servers answer
  // within a second, then every half second so a slow one is not hammered.
  const delays = [100, 250, 500];
  for (let attempt = 0; ; attempt += 1) {
    if (exit) {
      const { code, signal } = exit;
      return fail(
        `webServer "${server.command}" exited ` +
          (signal ? `on ${signal}` : `with code ${code}`) +
          ` before ${server.url} answered.`,
      );
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return fail(
        `webServer timed out: "${server.command}" ` +
          (lastStatus === null
            ? `did not answer at ${server.url} `
            : `answered only HTTP ${lastStatus} at ${server.url} `) +
          `within ${seconds(server.timeoutMs)}` +
          (lastStatus === null
            ? "."
            : ", and a 5xx means the server can't serve pages yet."),
      );
    }
    const answer = await probe(server.url, Math.min(5_000, remaining));
    if (answer.up && isReady(answer.status)) {
      return {
        started: true,
        detail:
          `started with "${server.command}", answered HTTP ${answer.status} ` +
          `after ${seconds(Date.now() - began)}`,
        stop,
      };
    }
    if (answer.up) lastStatus = answer.status;
    // Two minutes of silence reads as a hang, and the usual cause is a command
    // that serves on another port than `url`, which only the log shows.
    if (!waitingSaid && Date.now() - began > SAY_WAITING_AFTER_MS) {
      waitingSaid = true;
      process.stderr.write(
        `app: still waiting for ${server.url} (up to ` +
          `${seconds(server.timeoutMs)}). Its output is in ${logFile}.\n`,
      );
    }
    await within(
      exited,
      Math.min(delays[Math.min(attempt, delays.length - 1)], remaining),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `promise`, or `ms`, whichever comes first — and the timer cleared when the
 * promise wins. A bare `Promise.race` with a sleep leaves the losing timer
 * armed, and an armed timer holds the process open: every command would sit
 * out the rest of a five-second grace period after it had finished.
 */
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Windows's way to stop a server: every process under `pid`, at once, with no
 * grace period, because Windows has no SIGTERM to give one with.
 *
 * Blocking, so it works from a signal handler and from the `exit` handler, which
 * cannot wait for anything. Returns what happened, for the log. Reads the exit
 * status and never the words, which taskkill translates into the machine's
 * language. It does not decide whether the server is gone either: the port check
 * after it does that, so a status this does not know is reported, not judged.
 */
function killTree(pid: number): string {
  const began = Date.now();
  const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return `stopped: taskkill could not run (${code})`;
  }
  if (result.status === 0) {
    return `stopped: taskkill, the whole tree after ${seconds(Date.now() - began)}`;
  }
  if (result.status === TASKKILL_NOT_FOUND) {
    return "stopped: it had already exited";
  }
  const said = result.stderr.split(/\r?\n/)[0];
  return `stopped: taskkill exited with ${result.status}: ${said}`;
}

/**
 * Signal every process in the group. False when nothing in it can be.
 *
 * "Nothing" has two spellings. ESRCH is the group being gone. EPERM, on macOS,
 * is the group still existing with only zombies in it — processes that have
 * exited and are waiting for launchd to reap them — because the kernel skips
 * zombies and then reports that it found no process it was allowed to signal.
 * Neither holds a port. Anything else is reported rather than thrown: this
 * runs in `finally` blocks and signal handlers, where throwing would bury the
 * error that got us there.
 */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EPERM") {
      process.stderr.write(
        `webServer: could not signal process group ${pid} (${code}).\n`,
      );
    }
    return false;
  }
}

/**
 * SIGTERM, up to `GRACE_MS` for the group to go, then SIGKILL. Returns what
 * happened, for the log: whether a server needed killing is exactly what a
 * database left in a bad state makes you want to know.
 *
 * "Gone" is the group, not the shell at its top: the shell exits at once and
 * its children — the actual server — are what hold the port. Waiting for the
 * shell's own exit too lets Node reap it, since an exited-but-unreaped child
 * is still a member of the group as far as `kill(-pid, 0)` is concerned.
 */
async function stopGroup(pid: number, exited: Promise<void>): Promise<string> {
  const began = Date.now();
  if (!signalGroup(pid, "SIGTERM")) return "stopped: it had already exited";
  if (await groupGone(pid, exited, GRACE_MS)) {
    return `stopped: SIGTERM, all of it gone after ${seconds(Date.now() - began)}`;
  }
  signalGroup(pid, "SIGKILL");
  if (await groupGone(pid, exited, 2_000)) {
    return `stopped: still running ${seconds(GRACE_MS)} after SIGTERM, so SIGKILL`;
  }
  const warning = `webServer: process group ${pid} is still there after SIGKILL.`;
  process.stderr.write(`${warning}\n`);
  return warning;
}

async function groupGone(
  pid: number,
  exited: Promise<void>,
  withinMs: number,
): Promise<boolean> {
  const until = Date.now() + withinMs;
  await within(exited, withinMs);
  while (Date.now() < until) {
    if (!signalGroup(pid, 0)) return true;
    await sleep(50);
  }
  return !signalGroup(pid, 0);
}
