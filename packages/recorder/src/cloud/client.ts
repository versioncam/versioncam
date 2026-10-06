import {
  CLOUD_PATHS,
  type AccountPlan,
  type Acknowledged,
  type ChangePending,
  type ChangeRequest,
  type ChangeState,
  type ClipDetail,
  type CloudErrorBody,
  type DeviceAuthorization,
  type DeviceToken,
  type Me,
  type ProjectStatus,
} from "./protocol.js";

/**
 * The client half of version.cam's management API: one function a route,
 * each answering the route's JSON or throwing a `CloudError`.
 *
 * It holds the token and sends it only to the API's own address. It knows
 * nothing about where the token is kept or how an answer is put into words;
 * the commands do, which keeps this testable against any server and keeps
 * the token's file out of everything that only talks to the network.
 */

/** A refusal, or a failure to get an answer at all, with a sentence for a person. */
export class CloudError extends Error {
  /** The HTTP status; 0 when no answer arrived. */
  readonly status: number;
  /** The service's code (`unauthorized`, `plan`, `slow_down`, …), `unreachable`, or `http` for an answer that was not the service's JSON. */
  readonly code: string;
  /** With `plan`: the upgrade page's address. */
  readonly upgrade: string | null;
  /** With `rate_limited`: how many seconds to wait. */
  readonly retryAfter: number | null;

  constructor(
    message: string,
    status: number,
    code: string,
    extra: { upgrade?: string | null; retryAfter?: number | null } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.upgrade = extra.upgrade ?? null;
    this.retryAfter = extra.retryAfter ?? null;
  }
}

/**
 * Whether asking again could change the answer: nothing came back, too many
 * requests came too fast, or the service failed. Only a command that waits
 * for a person asks again; every other command says so and stops.
 */
export function transient(error: unknown): error is CloudError {
  return (
    error instanceof CloudError &&
    (error.status === 0 || error.status === 429 || error.status >= 500)
  );
}

export type CloudClientOptions = {
  /** The API's address, e.g. https://api.version.cam. */
  api: string;
  /** A `vcu_` token; only the sign-in routes go without one. */
  token?: string | null;
  fetch?: typeof fetch;
};

export type CloudClient = ReturnType<typeof cloudClient>;

export function cloudClient(options: CloudClientOptions) {
  const base = options.api.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  async function call<T>(
    method: string,
    path: string,
    { body, signedIn = true }: { body?: unknown; signedIn?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (signedIn) {
      if (!options.token) {
        throw new CloudError(
          "Not signed in: run `versioncam cloud login` first.",
          401,
          "unauthorized",
        );
      }
      headers.authorization = `Bearer ${options.token}`;
    }

    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect would carry the request, token and all, wherever it
        // pointed. The API never redirects, so one is an address that is
        // not the API's, and it is said so rather than followed.
        redirect: "manual",
      });
    } catch (error) {
      throw new CloudError(
        `Could not reach ${base}: ${reason(error)}.`,
        0,
        "unreachable",
      );
    }

    const text = await response.text();
    if (response.status >= 300 && response.status < 400) {
      throw new CloudError(
        `${base} answered ${method} ${path} with a redirect, which the API never does. Is VERSIONCAM_API the API's own address?`,
        response.status,
        "http",
      );
    }
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not the service's JSON: a proxy, or an address that is not the API.
    }
    if (response.ok) {
      if (text && parsed === null) {
        throw new CloudError(
          `${method} ${path} answered ${response.status} with something that is not JSON: ${text.slice(0, 200)}`,
          response.status,
          "http",
        );
      }
      return parsed as T;
    }
    const refusal = parsed as Partial<CloudErrorBody> | null;
    if (refusal && typeof refusal.error === "string") {
      throw new CloudError(
        typeof refusal.message === "string" && refusal.message
          ? refusal.message
          : `${method} ${path} answered ${response.status}: ${refusal.error}`,
        response.status,
        refusal.error,
        {
          upgrade: typeof refusal.upgrade === "string" ? refusal.upgrade : null,
          retryAfter:
            typeof refusal.retry_after === "number"
              ? refusal.retry_after
              : null,
        },
      );
    }
    throw new CloudError(
      `${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`,
      response.status,
      "http",
    );
  }

  return {
    /** Start a sign-in. `label` names this machine on the approval page. */
    device: (label: string | null) =>
      call<DeviceAuthorization>("POST", CLOUD_PATHS.device, {
        body: label ? { label } : {},
        signedIn: false,
      }),
    /** Ask whether the sign-in was approved; the token, once it was. */
    token: (deviceCode: string) =>
      call<DeviceToken>("POST", CLOUD_PATHS.token, {
        body: { device_code: deviceCode },
        signedIn: false,
      }),
    /** Revoke the token this client holds. */
    revoke: () => call<null>("DELETE", CLOUD_PATHS.token),
    me: () => call<Me>("GET", CLOUD_PATHS.me),
    project: (project: string) =>
      call<ProjectStatus>("GET", CLOUD_PATHS.project(project)),
    clip: (project: string, clip: string) =>
      call<ClipDetail>("GET", CLOUD_PATHS.clip(project, clip)),
    ack: (project: string, clip: string) =>
      call<Acknowledged>("POST", CLOUD_PATHS.ack(project, clip)),
    change: (project: string, request: ChangeRequest) =>
      call<ChangePending>("POST", CLOUD_PATHS.changes(project), {
        body: request,
      }),
    changeState: (project: string, change: string) =>
      call<ChangeState>("GET", CLOUD_PATHS.change(project, change)),
    plan: (account: string) =>
      call<AccountPlan>("GET", CLOUD_PATHS.plan(account)),
  };
}

/**
 * Why a request got no answer, in a few words: Node's fetch says only
 * "fetch failed", and puts the reason (refused, no such host) in `cause`.
 */
function reason(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } })
    ?.cause;
  if (typeof cause?.code === "string") return cause.code;
  if (typeof cause?.message === "string") return cause.message;
  return (error as Error)?.message ?? String(error);
}
