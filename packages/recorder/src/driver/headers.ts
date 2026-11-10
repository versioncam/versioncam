import type { BrowserContext, Request } from "playwright";

/**
 * Request headers the app's own requests carry: the config's `headers`.
 *
 * A deployed preview often sits behind its host's protection, and gets
 * through it with a header: Vercel's `x-vercel-protection-bypass` with the
 * project's automation secret, Cloudflare Access's service token pair. So
 * the value is usually a secret, and everything here is about where it
 * goes and where it does not.
 *
 * - **Only to the app's origin.** Playwright's `extraHTTPHeaders` sends a
 *   header on every request the context makes, to any host: a font, an
 *   analytics script and a map's tiles would all receive the secret (tried
 *   on 2026-11-10, WP20's log). A context route on `baseUrl`'s origin adds
 *   them to the app's own requests and nothing else.
 * - **Through the app's own redirects.** Playwright calls a route for the
 *   first request of a redirect chain only, and Chromium keeps the headers
 *   it was given for every hop after. So a sign-in that posts and is
 *   redirected to the start page carries them on both, which is what makes
 *   a protected preview work at all where the host sets no cookie. The
 *   same rule means a hop to *another* host carries them too, and nothing
 *   the recorder can do stops it: there is no route call for the hop to
 *   take them off. So the recorder watches for such a hop and names the
 *   host (`watchRedirects`), and the README says so.
 * - **Never into a replay file.** A route's headers are what
 *   `request.allHeaders()` answers afterwards, which is what a replay
 *   writes down, so every name here joins the replay's list of headers it
 *   never writes (`ResolvedReplay.headers`).
 * - **An empty value sends nothing**, so one config runs on a laptop
 *   without the secret and in CI with it.
 *
 * A route also turns the browser's HTTP cache off for the context, which
 * Playwright does for any route. Only for a config with headers to send:
 * one without them records exactly as before.
 */

export type HeadersConfig = Record<string, string | undefined>;

export type ResolvedHeaders = {
  /** `baseUrl`'s origin, the only one that gets them. */
  origin: string;
  /** The ones with a value, by name as the config wrote it. */
  send: Record<string, string>;
  /** Every name the config gave, lower case, sent or not. */
  names: string[];
};

/** RFC 9110's token: what an HTTP header name may be made of. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Names the browser decides for itself. Chromium ignores a route's
 * `cookie` and Playwright says so; a `host` would send the request
 * somewhere it was not addressed. Each has its own field in the config.
 */
const REFUSED: Record<string, string> = {
  cookie: "use `auth.storageState` or a `login` hook for cookies",
  host: "the browser sets it from `baseUrl`",
};

function fail(field: string, why: string): never {
  throw new Error(`versioncam config: \`${field}\` ${why}`);
}

/** Checked where it enters, because a wrong one fails as a 401 far from here. */
export function headersOf(
  given: unknown,
  baseUrl: string,
): ResolvedHeaders | null {
  if (given === undefined) return null;
  if (given === null || typeof given !== "object" || Array.isArray(given)) {
    fail("headers", "must be an object of header names and values");
  }
  const send: Record<string, string> = {};
  const names: string[] = [];
  for (const [name, value] of Object.entries(given)) {
    if (!TOKEN.test(name)) {
      fail(
        "headers",
        `has ${JSON.stringify(name)}, which is not a header name`,
      );
    }
    const lower = name.toLowerCase();
    if (REFUSED[lower])
      fail(`headers.${name}`, `can't be set: ${REFUSED[lower]}`);
    if (names.includes(lower)) {
      fail("headers", `names ${name} twice, in different cases`);
    }
    if (value !== undefined && typeof value !== "string") {
      // The value is never printed: it is usually a secret.
      fail(`headers.${name}`, `must be a string, got a ${typeof value}`);
    }
    names.push(lower);
    if (value) send[name] = value;
  }
  if (names.length === 0) return null;
  // Only now: a config without headers keeps whatever `baseUrl` it had.
  if (!URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol)) {
    fail(
      "headers",
      `go to \`baseUrl\`'s origin, and ${baseUrl} is not an http(s) URL`,
    );
  }
  return { origin: new URL(baseUrl).origin, send, names };
}

/**
 * Add the headers to every request to the app's origin. A no-op when none
 * has a value.
 *
 * Call it after any other context route that should see the headers, a
 * replay's above all: Playwright tries routes in the reverse of the order
 * they were added, so this one runs first and hands the request on, with
 * the headers, to the next (`route.fallback`). A replay recording a
 * response then fetches it with them, as the browser would have.
 */
export async function sendHeaders(
  context: BrowserContext,
  headers: ResolvedHeaders | null,
): Promise<void> {
  if (!headers || Object.keys(headers.send).length === 0) return;
  const { origin, send } = headers;
  await context.route(
    (url) => url.origin === origin,
    (route) =>
      route.fallback({ headers: { ...route.request().headers(), ...send } }),
  );
  watchRedirects(context, headers);
}

/**
 * Say so when a redirect took the headers to another host.
 *
 * Once per host per context, as it happens. A warning and not a failure:
 * an app that sends its sign-in to an identity provider does it on every
 * run, and that is a flow a clip must be able to record. What the person
 * can do about it is in the message.
 */
function watchRedirects(
  context: BrowserContext,
  headers: ResolvedHeaders,
): void {
  const told = new Set<string>();
  context.on("request", (request) => {
    const host = carriedTo(request, headers.origin);
    if (host === null || told.has(host)) return;
    told.add(host);
    console.warn(
      `[recorder] headers: the app redirected a request to ${host}, and the browser sends a request's headers on through its redirects, ` +
        `so ${host} received ${Object.keys(headers.send).join(", ")}. ` +
        "If one of them is a secret and you don't trust that host with it, change the secret and stop the app redirecting there while it is recorded.",
    );
  });
}

/**
 * The host a request took the headers to, when it is a redirect's hop off
 * the app's origin in a chain whose first request was to the app; else
 * null. Only the first request matters: it is the only one the route saw,
 * and so the only one that can have been given the headers.
 */
export function carriedTo(request: Request, origin: string): string | null {
  let first = request.redirectedFrom();
  if (first === null) return null;
  const url = new URL(request.url());
  if (url.origin === origin) return null;
  for (let at = first.redirectedFrom(); at !== null; at = at.redirectedFrom()) {
    first = at;
  }
  return new URL(first.url()).origin === origin ? url.host : null;
}
