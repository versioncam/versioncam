import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BrowserContext, Request, Route } from "playwright";

/**
 * Record a clip's responses once, and serve them on every run after.
 *
 * Some of what a clip films is not the app's to decide: a map's tiles, a
 * model's answer, a job's status, a count that grows. Each comes from a
 * server, at the server's speed and in its words of the day, so two
 * recordings of one clip differ wherever one of them reaches the page, and
 * the clip can never be re-rendered the same. The fix every app reached for
 * was a mock written by hand, which is right once and wrong the day the
 * endpoint changes. A replay is the server's own answer, written down the
 * first time the clip runs and kept beside the clip as an input: the
 * requests the config names are answered from it, and a request it does not
 * hold fails the clip, with its URL, instead of quietly going live.
 *
 * The file is a HAR (one per clip, `<dir>/<clip>.har`), so a browser's
 * developer tools can open it. Text bodies are written into it, where a
 * diff can read them; binary bodies (a tile, an image) go beside it, under
 * `bodies/`, named by their hash, so clips that load the same tiles store
 * them once.
 */

export type ReplayMode = "auto" | "record" | "replay" | "live";

/** A glob, in Playwright's syntax, or a regular expression, over the whole URL. */
export type ReplayPattern = string | RegExp;

export type ReplayConfig = {
  /** The requests to record and replay, by URL. */
  record: ReplayPattern[];
  /**
   * `"auto"`, the default, replays a clip whose file exists and records one
   * whose file does not. `"record"` always records, `"replay"` fails a clip
   * without a file, and `"live"` leaves every request to the network.
   */
  mode?: ReplayMode;
  /** Where the files go. Default `replay/` beside the config. Commit it. */
  dir?: string;
  /**
   * Responses the page reads over time, an event stream or lines of JSON,
   * delivered one event or one line every `chunkMs` of the page's clock, so
   * the same piece lands on the same frame every run.
   */
  pace?: { url: ReplayPattern; chunkMs: number }[];
  /** Query parameters left out of the file and of the match, by name. */
  redact?: string[];
  /**
   * What a request the replay does not hold does: `"fail"`, the default,
   * fails the clip and names it; `"live"` sends it to the network and warns.
   */
  onMissing?: "fail" | "live";
};

export type ResolvedReplay = {
  record: RegExp[];
  mode: ReplayMode;
  dir: string;
  pace: { url: RegExp; chunkMs: number }[];
  redact: string[];
  onMissing: "fail" | "live";
  /**
   * `baseUrl`'s origin, or null when it has none. Requests to it are matched
   * by path and query, on any host: see `ReplayBook`.
   */
  origin: string | null;
  /**
   * The config's `headers`, by name, lower case: never written, like the
   * secrets below. A header the recorder adds to a request is one
   * `request.allHeaders()` answers with afterwards, so without this a
   * preview's bypass secret would be written into a file that is committed.
   */
  headers: string[];
};

/** Headers removed from every recorded request and response. */
const SECRET_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
]);

/**
 * A body has to be served as the bytes it was, so these never go back to the
 * page with it: the encoding was undone when it was recorded, and the length
 * is whatever the bytes are now.
 */
const TRANSPORT_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

/** How old a replay may be before `check` says so. */
export const STALE_DAYS = 90;

/**
 * A glob in Playwright's syntax as a regular expression, so the recorder and
 * the script it puts in the page match a URL the same way: `**` crosses `/`,
 * `*` does not, `{a,b}` is either, and every other character is itself, `?`
 * included. Anchored at both ends, as Playwright anchors a glob.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "^";
  let inGroup = false;
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "\\" && i + 1 < glob.length) {
      out += escapeRegExp(glob[i + 1]);
      i += 1;
    } else if (c === "*") {
      const starStar = glob[i + 1] === "*";
      out += starStar ? ".*" : "[^/]*";
      if (starStar) i += 1;
    } else if (c === "{") {
      inGroup = true;
      out += "(?:";
    } else if (c === "}" && inGroup) {
      inGroup = false;
      out += ")";
    } else if (c === "," && inGroup) {
      out += "|";
    } else {
      out += escapeRegExp(c);
    }
  }
  return new RegExp(`${out}$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function patternOf(pattern: ReplayPattern): RegExp {
  return typeof pattern === "string" ? globToRegExp(pattern) : pattern;
}

/**
 * The URL a request is known by in the file: without its fragment and
 * without the query parameters `redact` names, which are gone from the file
 * and so cannot be part of the match.
 */
export function urlKey(url: string, redact: readonly string[]): string {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const name of redact) parsed.searchParams.delete(name);
  return parsed.href;
}

type Header = { name: string; value: string };

type HarContent = {
  size: number;
  mimeType: string;
  text?: string;
  encoding?: "base64";
  /** A binary body, under the replay's `bodies/`, by its SHA-256. */
  _file?: string;
};

export type HarEntry = {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Header[];
    queryString: Header[];
    cookies: [];
    headersSize: -1;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Header[];
    cookies: [];
    content: HarContent;
    redirectURL: string;
    headersSize: -1;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
};

export type Har = {
  log: {
    version: "1.2";
    creator: { name: string; version: string };
    comment: string;
    _versioncam: {
      clip: string;
      recorded: string;
      recorder: string;
      /**
       * The app's origin the replay was recorded against. Absent from a
       * replay written before 0.8.0, which then matches whole URLs.
       */
      origin?: string;
    };
    entries: HarEntry[];
  };
};

function withoutSecrets(
  headers: Record<string, string>,
  also: readonly string[],
): Header[] {
  return Object.entries(headers)
    .filter(([name]) => {
      const lower = name.toLowerCase();
      return !SECRET_HEADERS.has(lower) && !also.includes(lower);
    })
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Text a person can read in a diff, or bytes that only mean something whole. */
function isText(mimeType: string): boolean {
  return /^text\/|json|javascript|xml|x-www-form-urlencoded|event-stream|svg/i.test(
    mimeType,
  );
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * One recorded exchange, as the file keeps it: the secrets and the redacted
 * parameters gone, a text body in the entry, a binary one handed to `store`
 * and named here by its hash.
 */
export function entryOf(
  exchange: {
    method: string;
    url: string;
    requestHeaders: Record<string, string>;
    postData: string | null;
    status: number;
    statusText: string;
    responseHeaders: Record<string, string>;
    body: Uint8Array;
  },
  options: {
    redact: readonly string[];
    recorded: string;
    store: (hash: string, bytes: Uint8Array) => void;
    /** The config's `headers`, lower case: left out like the secrets. */
    headers?: readonly string[];
  },
): HarEntry {
  const dropped = options.headers ?? [];
  const url = urlKey(exchange.url, options.redact);
  const mimeType =
    Object.entries(exchange.responseHeaders).find(
      ([name]) => name.toLowerCase() === "content-type",
    )?.[1] ?? "application/octet-stream";
  let content: HarContent;
  if (isText(mimeType)) {
    content = {
      size: exchange.body.length,
      mimeType,
      text: Buffer.from(exchange.body).toString("utf8"),
    };
  } else {
    const hash = sha256(exchange.body);
    options.store(hash, exchange.body);
    content = { size: exchange.body.length, mimeType, _file: hash };
  }
  const requestType =
    Object.entries(exchange.requestHeaders).find(
      ([name]) => name.toLowerCase() === "content-type",
    )?.[1] ?? "application/octet-stream";
  return {
    startedDateTime: options.recorded,
    time: 0,
    request: {
      method: exchange.method,
      url,
      httpVersion: "HTTP/1.1",
      headers: withoutSecrets(exchange.requestHeaders, dropped),
      queryString: [...new URL(url).searchParams].map(([name, value]) => ({
        name,
        value,
      })),
      cookies: [],
      headersSize: -1,
      bodySize: exchange.postData?.length ?? 0,
      ...(exchange.postData !== null
        ? { postData: { mimeType: requestType, text: exchange.postData } }
        : {}),
    },
    response: {
      status: exchange.status,
      statusText: exchange.statusText,
      httpVersion: "HTTP/1.1",
      headers: withoutSecrets(exchange.responseHeaders, dropped),
      cookies: [],
      content,
      redirectURL: "",
      headersSize: -1,
      bodySize: exchange.body.length,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
  };
}

/**
 * The entries of a replay, by what a request is known by, each list in the
 * order the requests were made, and served in that order: the third poll of
 * a job's status gets the third answer the job gave, and every poll after
 * the last gets the last. Among answers to one URL, one recorded for the
 * same request body is taken first, for an app that posts several queries
 * to one endpoint in an order that can vary.
 *
 * A request to the app itself is known by its path and query, not its
 * host, when the replay says which origin it was recorded against
 * (`origins`). A deployed preview has a new host for every commit, and a
 * replay recorded against `localhost` or yesterday's preview has to answer
 * today's: keyed by the whole URL, it never matched again (WP20, A1).
 * Every other host, an API or a tile server, is still matched whole.
 */
export class ReplayBook {
  private readonly byKey = new Map<string, HarEntry[]>();
  private readonly used = new Map<string, Set<number>>();
  private readonly redact: readonly string[];
  private readonly origins: { recorded: string; current: string } | null;

  constructor(
    entries: readonly HarEntry[],
    redact: readonly string[],
    origins: { recorded?: string | null; current?: string | null } = {},
  ) {
    this.redact = redact;
    this.origins =
      origins.recorded && origins.current
        ? { recorded: origins.recorded, current: origins.current }
        : null;
    for (const entry of entries) {
      const key = `${entry.request.method} ${this.appRelative(entry.request.url, "recorded")}`;
      const list = this.byKey.get(key) ?? [];
      list.push(entry);
      this.byKey.set(key, list);
    }
  }

  answer(
    method: string,
    url: string,
    postData: string | null,
  ): HarEntry | null {
    const key = `${method} ${this.appRelative(urlKey(url, this.redact), "current")}`;
    const list = this.byKey.get(key);
    if (!list || list.length === 0) return null;
    const used = this.used.get(key) ?? new Set<number>();
    this.used.set(key, used);
    const unused = list
      .map((entry, index) => ({ entry, index }))
      .filter(({ index }) => !used.has(index));
    const pick =
      unused.find(
        ({ entry }) => (entry.request.postData?.text ?? null) === postData,
      ) ?? unused[0];
    if (!pick) return list[list.length - 1];
    used.add(pick.index);
    return pick.entry;
  }

  /** A URL on the app's origin as the app's own, `app:` and its path; any other as it is. */
  private appRelative(url: string, side: "recorded" | "current"): string {
    if (!this.origins) return url;
    const parsed = new URL(url);
    if (parsed.origin !== this.origins[side]) return url;
    return `app:${parsed.pathname}${parsed.search}`;
  }
}

/** The file a clip's replay is in. */
export function replayFile(dir: string, clipId: string): string {
  return join(dir, `${clipId}.har`);
}

export function readReplay(file: string): Har {
  return JSON.parse(readFileSync(file, "utf8")) as Har;
}

/** What `doctor` and `check` say about a clip's replay. */
export function describeReplay(
  dir: string,
  clipId: string,
  now = new Date(),
):
  | { file: string; exists: false }
  | {
      file: string;
      exists: true;
      requests: number;
      recorded: string;
      ageDays: number;
      recorder: string;
    } {
  const file = replayFile(dir, clipId);
  if (!existsSync(file)) return { file, exists: false };
  const har = readReplay(file);
  const recorded =
    har.log._versioncam?.recorded ?? har.log.entries[0]?.startedDateTime ?? "";
  const ageDays = recorded
    ? Math.floor((now.getTime() - new Date(recorded).getTime()) / 86_400_000)
    : Number.NaN;
  return {
    file,
    exists: true,
    requests: har.log.entries.length,
    recorded,
    ageDays,
    recorder: har.log._versioncam?.recorder ?? har.log.creator.version,
  };
}

/** Which mode a clip runs in, once the file's presence is known. */
export function effectiveMode(
  mode: ReplayMode,
  fileExists: boolean,
): "record" | "replay" | "live" {
  if (mode === "auto") return fileExists ? "replay" : "record";
  return mode;
}

/**
 * A clip's replay while it runs: the routes it installs, what it recorded,
 * what it could not answer, and how many answers are still on their way.
 */
export class ClipReplay {
  readonly mode: "record" | "replay" | "live";
  readonly file: string;
  /** Requests the replay matched and did not hold, as "METHOD url". */
  readonly misses: string[] = [];
  /** Requests sent live because the replay did not hold them (`onMissing: "live"`). */
  readonly wentLive: string[] = [];
  private readonly recorded: HarEntry[] = [];
  private readonly bodies = new Map<string, Uint8Array>();
  private readonly book: ReplayBook | null;
  private readonly when = new Date().toISOString();
  private inFlight = 0;
  private waiters: (() => void)[] = [];
  /** How many `aside` calls are running: while any is, nothing is replayed. */
  private asideDepth = 0;
  private readonly config: ResolvedReplay;
  private readonly clipId: string;
  private readonly recorder: string;

  constructor(
    config: ResolvedReplay,
    clipId: string,
    recorder: string,
    override?: ReplayMode,
  ) {
    this.config = config;
    this.clipId = clipId;
    this.recorder = recorder;
    this.file = replayFile(config.dir, clipId);
    this.mode = effectiveMode(override ?? config.mode, existsSync(this.file));
    if (this.mode === "replay" && !existsSync(this.file)) {
      throw new Error(
        `Clip "${clipId}" replays its responses from ${this.file}, and there is no such file. ` +
          "Record it once: `versioncam record " +
          clipId +
          " --replay record`.",
      );
    }
    this.book =
      this.mode === "replay" ? this.bookOf(readReplay(this.file)) : null;
  }

  private bookOf(har: Har): ReplayBook {
    return new ReplayBook(har.log.entries, this.config.redact, {
      recorded: har.log._versioncam?.origin,
      current: this.config.origin,
    });
  }

  /** The page-side script that paces streamed bodies, or null when nothing is paced. */
  pacingScript(): string | null {
    if (this.mode === "live" || this.config.pace.length === 0) return null;
    return pacedReplayScript(this.config.pace);
  }

  /** Install the routes. Before the page is opened, so its first request is caught. */
  async install(context: BrowserContext): Promise<void> {
    if (this.mode === "live") return;
    for (const pattern of this.config.record) {
      await context.route(pattern, (route) => this.handle(route));
    }
  }

  /**
   * Resolves once every request the replay has taken is answered and its body
   * is in the page. The driver waits on it after each tick, so a request made
   * in a frame is answered within that frame on every run, however long the
   * network or the disk took: a tile arrives on the frame it was asked for.
   */
  async idle(timeoutMs = 30_000): Promise<void> {
    if (this.inFlight === 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Run `fn` with every request going to the network, neither recorded nor
   * served. For the login hook.
   *
   * A sign-in's request carries the password in its body, and a replay
   * writes request bodies down: on 2026-11-10 a replay of everything under
   * `/api/` wrote a test account's password into the HAR beside a clip, a
   * file that is committed. And a replayed sign-in could not work anyway:
   * the replay keeps no `set-cookie`, so the browser would never be signed
   * in. So the hook talks to the real app, every run, and whatever the clip
   * does after it is recorded and replayed as before.
   */
  async aside<T>(fn: () => Promise<T>): Promise<T> {
    this.asideDepth += 1;
    try {
      return await fn();
    } finally {
      this.asideDepth -= 1;
    }
  }

  private settled(): void {
    this.inFlight -= 1;
    if (this.inFlight > 0) return;
    const waiting = this.waiters;
    this.waiters = [];
    for (const wake of waiting) wake();
  }

  private async handle(route: Route): Promise<void> {
    if (this.asideDepth > 0) {
      await route.fallback();
      return;
    }
    this.inFlight += 1;
    const request = route.request();
    try {
      if (this.mode === "record") await this.record(route, request);
      else await this.serve(route, request);
      // Fulfilled is not yet received: the body is in the page once its
      // response has finished, and only then is the frame's picture the one
      // with the answer in it.
      const response = await request.response().catch(() => null);
      await response?.finished().catch(() => undefined);
    } finally {
      this.settled();
    }
  }

  private async record(route: Route, request: Request): Promise<void> {
    let response;
    try {
      response = await route.fetch({ timeout: 60_000 });
    } catch (error) {
      await route.abort("failed").catch(() => undefined);
      console.warn(
        `[recorder] replay: ${request.method()} ${request.url()} failed while recording (${(error as Error).message.split("\n")[0]}); not recorded.`,
      );
      return;
    }
    const body = await response.body();
    await route.fulfill({ response, body }).catch(() => undefined);
    this.recorded.push(
      entryOf(
        {
          method: request.method(),
          url: request.url(),
          requestHeaders: await request.allHeaders(),
          postData: request.postData(),
          status: response.status(),
          statusText: response.statusText(),
          responseHeaders: response.headers(),
          body,
        },
        {
          redact: this.config.redact,
          recorded: this.when,
          store: (hash, bytes) => this.bodies.set(hash, bytes),
          headers: this.config.headers,
        },
      ),
    );
  }

  private async serve(route: Route, request: Request): Promise<void> {
    const entry = this.book?.answer(
      request.method(),
      request.url(),
      request.postData(),
    );
    if (!entry) {
      const what = `${request.method()} ${request.url()}`;
      if (this.config.onMissing === "live") {
        this.wentLive.push(what);
        console.warn(
          `[recorder] replay: ${what} is not in ${this.file}; sent to the network.`,
        );
        await route.fallback();
        return;
      }
      this.misses.push(what);
      await route.abort("failed").catch(() => undefined);
      return;
    }
    const { content } = entry.response;
    const body = content._file
      ? readFileSync(join(this.config.dir, "bodies", content._file))
      : content.encoding === "base64"
        ? Buffer.from(content.text ?? "", "base64")
        : Buffer.from(content.text ?? "", "utf8");
    const headers: Record<string, string> = {};
    for (const { name, value } of entry.response.headers) {
      if (!TRANSPORT_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    await route
      .fulfill({ status: entry.response.status, headers, body })
      .catch(() => undefined);
  }

  /**
   * What stops the clip: a request the replay was asked for and did not
   * hold. Null when there is none.
   */
  failure(): string | null {
    if (this.misses.length === 0) return null;
    const shown = this.misses.slice(0, 5).join("\n  ");
    const more =
      this.misses.length > 5 ? `\n  and ${this.misses.length - 5} more` : "";
    return (
      `Clip "${this.clipId}" asked for ${this.misses.length} response(s) its replay does not hold:\n  ${shown}${more}\n` +
      `The app has changed what it fetches since ${this.file} was recorded. ` +
      `Record it again: \`versioncam record ${this.clipId} --replay record\`.`
    );
  }

  /**
   * Write what was recorded. Only for a clip that passed: a replay of half a
   * clip would serve a later run a different app than the one it shows.
   */
  write(): void {
    if (this.mode !== "record") return;
    mkdirSync(dirname(this.file), { recursive: true });
    if (this.bodies.size > 0) {
      mkdirSync(join(this.config.dir, "bodies"), { recursive: true });
      for (const [hash, bytes] of this.bodies) {
        const path = join(this.config.dir, "bodies", hash);
        if (!existsSync(path)) writeFileSync(path, bytes);
      }
    }
    const har: Har = {
      log: {
        version: "1.2",
        creator: { name: "versioncam", version: this.recorder },
        comment:
          `Recorded for the clip "${this.clipId}" on ${this.when.slice(0, 10)}. ` +
          // The config's headers are named only when there are some, so a
          // replay recorded without them reads as it always has.
          (this.config.headers.length > 0
            ? `Authorization, cookies, API key headers and the config's headers (${this.config.headers.join(", ")}) were removed, and the query `
            : "Authorization, cookies and API key headers were removed, and the query ") +
          `parameters ${this.config.redact.length > 0 ? this.config.redact.join(", ") : "none named"} left out.`,
        _versioncam: {
          clip: this.clipId,
          recorded: this.when,
          recorder: this.recorder,
          ...(this.config.origin ? { origin: this.config.origin } : {}),
        },
        entries: this.recorded,
      },
    };
    writeFileSync(this.file, `${JSON.stringify(har, null, 2)}\n`);
  }
}

/**
 * Deliver a paced response a piece at a time on the page's own clock.
 *
 * The recorder cannot stream a response into the page: Playwright fulfils a
 * request whole. So the page does it. For a URL the config paces, `fetch`
 * hands back a response whose body is a stream that gives out one event of
 * an event stream, or one line of anything else, every `chunkMs`, on the
 * page's `setTimeout`, which the recorder's clock advances a frame at a
 * time; and `EventSource` dispatches one event every `chunkMs` the same
 * way. The same piece therefore lands on the same frame every run, at any
 * frame rate. `window.__recorderReplay.pending` counts the bodies still
 * arriving, and a settle waits for it to reach none.
 *
 * An `EventSource` whose stream has ended reports an error and stays
 * closed, instead of reconnecting as a live one would: a replay would only
 * answer it with the same stream again.
 */
export function pacedReplayScript(
  pace: readonly { url: RegExp; chunkMs: number }[],
): string {
  const rules = pace.map(({ url, chunkMs }) => ({
    source: url.source,
    flags: url.flags.replace("g", ""),
    chunkMs,
  }));
  return `(() => {
  const rules = ${JSON.stringify(rules)}.map((r) => ({ test: new RegExp(r.source, r.flags), chunkMs: r.chunkMs }));
  const state = { pending: 0 };
  window.__recorderReplay = state;
  const absolute = (url) => new URL(String(url), location.href).href;
  const paceOf = (url) => {
    for (const rule of rules) if (rule.test.test(url)) return rule.chunkMs;
    return null;
  };
  const later = (ms, fn) => window.setTimeout(fn, ms);
  const pieces = (text, type) => {
    const parts = /event-stream/i.test(type) ? text.split(/(?<=\\r?\\n\\r?\\n)/) : text.split(/(?<=\\n)/);
    return parts.filter((part) => part.length > 0);
  };
  const native = window.fetch;
  window.fetch = async function (input, init) {
    const url = absolute(typeof input === "string" || input instanceof URL ? input : input.url);
    const ms = paceOf(url);
    if (ms === null) return native.apply(this, arguments);
    const response = await native.apply(this, arguments);
    if (response.type === "opaque" || !response.body || response.status === 204 || response.status === 304) return response;
    const parts = pieces(await response.text(), response.headers.get("content-type") || "");
    const encoder = new TextEncoder();
    const signal = init && init.signal;
    state.pending += 1;
    let open = true;
    const done = () => { if (open) { open = false; state.pending -= 1; } };
    const body = new ReadableStream({
      start(controller) {
        let i = 0;
        const next = () => {
          if (!open) return;
          if (signal && signal.aborted) { done(); controller.error(new DOMException("The operation was aborted.", "AbortError")); return; }
          if (i >= parts.length) { done(); controller.close(); return; }
          controller.enqueue(encoder.encode(parts[i]));
          i += 1;
          later(ms, next);
        };
        next();
      },
      cancel() { done(); },
    });
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    const paced = new Response(body, { status: response.status, statusText: response.statusText, headers });
    Object.defineProperty(paced, "url", { value: response.url });
    return paced;
  };
  const NativeEventSource = window.EventSource;
  if (typeof NativeEventSource === "function") {
    const parse = (text) => text.split(/\\r?\\n\\r?\\n/).map((block) => {
      const event = { type: "message", data: [], id: "" };
      for (const line of block.split(/\\r?\\n/)) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event.type = value;
        else if (field === "data") event.data.push(value);
        else if (field === "id") event.id = value;
      }
      return event;
    }).filter((event) => event.data.length > 0);
    class PacedEventSource extends EventTarget {
      constructor(url, init) {
        super();
        this.url = absolute(url);
        this.withCredentials = Boolean(init && init.withCredentials);
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        const ms = paceOf(this.url);
        state.pending += 1;
        let open = true;
        this._done = () => { if (open) { open = false; state.pending -= 1; } };
        native(this.url, { credentials: this.withCredentials ? "include" : "same-origin", headers: { Accept: "text/event-stream" } })
          .then((response) => response.text())
          .then((text) => {
            if (this.readyState === 2) return this._done();
            this.readyState = 1;
            this._fire(new Event("open"));
            const events = parse(text);
            let i = 0;
            const origin = new URL(this.url).origin;
            const next = () => {
              if (this.readyState === 2) return this._done();
              if (i >= events.length) { this.readyState = 2; this._fire(new Event("error")); return this._done(); }
              const e = events[i];
              i += 1;
              this._fire(new MessageEvent(e.type, { data: e.data.join("\\n"), lastEventId: e.id, origin }));
              later(ms, next);
            };
            next();
          }, () => { this.readyState = 2; this._fire(new Event("error")); this._done(); });
      }
      _fire(event) {
        const handler = this["on" + event.type];
        if (typeof handler === "function") handler.call(this, event);
        this.dispatchEvent(event);
      }
      close() { this.readyState = 2; this._done(); }
    }
    const EventSourceOrPaced = function EventSource(url, init) {
      if (paceOf(absolute(url)) === null) return new NativeEventSource(url, init);
      return new PacedEventSource(url, init);
    };
    EventSourceOrPaced.prototype = NativeEventSource.prototype;
    for (const [name, value] of [["CONNECTING", 0], ["OPEN", 1], ["CLOSED", 2]]) {
      Object.defineProperty(EventSourceOrPaced, name, { value });
      Object.defineProperty(PacedEventSource.prototype, name, { value });
    }
    window.EventSource = EventSourceOrPaced;
  }
})();`;
}
