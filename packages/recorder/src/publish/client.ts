import {
  PUBLISH_PATHS,
  type PublishBegin,
  type PublishBeginResponse,
  type PublishCommitResponse,
  type PublishErrorBody,
} from "./protocol.js";

/**
 * The client half of the publish protocol: begin, upload what the service
 * does not have yet, commit.
 *
 * It knows nothing about recordings on disk. `files` hands it bytes on
 * request, which keeps it testable against a fake `fetch` and keeps a state
 * the service already has from ever being read off the disk.
 */

/** Bytes for what the service asks for, looked up lazily. */
export type PublishFiles = {
  state(hash: string): Promise<Uint8Array>;
  timeline(clip: string): Promise<Uint8Array>;
  targets(clip: string): Promise<Uint8Array>;
  failure(clip: string): Promise<Uint8Array>;
};

export type PublishOptions = {
  /** The API's origin, e.g. https://api.version.cam. */
  api: string;
  /** A GitHub OpenID Connect token, or a `vc_` project token. */
  credential: string;
  fetch?: typeof fetch;
  /** How many uploads run at once. */
  concurrency?: number;
  /** Waits between retries, in milliseconds; the last one is the last try. */
  backoffMs?: readonly number[];
  log?: (line: string) => void;
};

/** An answer from the service that no retry will change. */
export class PublishRefused extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function publishRecordings(
  begin: PublishBegin,
  files: PublishFiles,
  options: PublishOptions,
): Promise<{ begun: PublishBeginResponse; committed: PublishCommitResponse }> {
  const call = caller(options);

  const begun = (await call("POST", PUBLISH_PATHS.begin, {
    body: JSON.stringify(begin),
    type: "application/json",
  })) as PublishBeginResponse;

  const uploads: (() => Promise<unknown>)[] = [
    ...begun.needStates.map(
      (hash) => async () =>
        call("PUT", PUBLISH_PATHS.state(begun.publishId, hash), {
          body: await files.state(hash),
          type: "image/png",
        }),
    ),
    ...begun.needTimelines.map(
      (clip) => async () =>
        call("PUT", PUBLISH_PATHS.timeline(begun.publishId, clip), {
          body: await files.timeline(clip),
          type: "application/json",
        }),
    ),
    ...begun.needTargets.map(
      (clip) => async () =>
        call("PUT", PUBLISH_PATHS.targets(begun.publishId, clip), {
          body: await files.targets(clip),
          type: "application/json",
        }),
    ),
    ...begun.needFailures.map(
      (clip) => async () =>
        call("PUT", PUBLISH_PATHS.failure(begun.publishId, clip), {
          body: await files.failure(clip),
          type: "image/png",
        }),
    ),
  ];
  options.log?.(
    `  uploading ${begun.needStates.length} new state(s) of ` +
      `${begin.clips.reduce((n, c) => n + (c.recording?.states.length ?? 0), 0)}`,
  );
  await pool(uploads, options.concurrency ?? 6);

  const committed = (await call("POST", PUBLISH_PATHS.commit(begun.publishId), {
    body: "{}",
    type: "application/json",
  })) as PublishCommitResponse;

  return { begun, committed };
}

type Call = (
  method: string,
  path: string,
  payload: { body: string | Uint8Array; type: string },
) => Promise<unknown>;

/**
 * One request, retried on what a retry can fix: a network error, a 429 or a
 * 5xx. Anything else is the service's considered answer, and its sentence is
 * passed on unchanged, because it names the limit or the problem better than
 * anything the client could add.
 */
function caller(options: PublishOptions): Call {
  const doFetch = options.fetch ?? fetch;
  const backoff = options.backoffMs ?? [1000, 2000, 4000];
  const origin = options.api.replace(/\/+$/, "");

  return async (method, path, payload) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= backoff.length; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(`${origin}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${options.credential}`,
            "content-type": payload.type,
          },
          // A copy for a byte body: fetch wants an ArrayBuffer-backed view,
          // and a Buffer read from disk may sit in a shared pool.
          body:
            typeof payload.body === "string"
              ? payload.body
              : new Uint8Array(payload.body),
        });
      } catch (error) {
        lastError = error;
        if (attempt < backoff.length) await sleep(backoff[attempt]);
        continue;
      }
      if (response.ok) {
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(
          `${method} ${path}: ${response.status} ${await response.text()}`,
        );
        if (attempt < backoff.length) await sleep(backoff[attempt]);
        continue;
      }
      const body = await response.text();
      let parsed: PublishErrorBody | null = null;
      try {
        parsed = JSON.parse(body) as PublishErrorBody;
      } catch {
        // Not the service's JSON: a proxy or a misconfigured API address.
      }
      throw new PublishRefused(
        parsed?.error ??
          `${method} ${path} answered ${response.status}: ${body.slice(0, 300)}`,
        response.status,
        parsed?.code ?? "http",
      );
    }
    throw new Error(
      `version.cam did not answer after ${backoff.length + 1} tries: ${(lastError as Error)?.message ?? lastError}`,
    );
  };
}

/** Run tasks with at most `size` in flight; the first failure fails the lot. */
async function pool(
  tasks: (() => Promise<unknown>)[],
  size: number,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(size, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const task = tasks[next];
        next += 1;
        await task();
      }
    },
  );
  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
