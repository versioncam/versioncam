/**
 * The management API's wire, as the command line reads it: what `versioncam
 * cloud` sends to version.cam's api host, and what comes back.
 *
 * Written from the contract the service and the command line were built
 * against at the same time, and kept free of Node like
 * `../publish/protocol.ts`, so that the service can one day import it as it
 * imports that one, and a field added on one side becomes a type error on the
 * other.
 *
 * Every route is JSON in and out, on the api host, and reads no cookie. A
 * route that needs a person takes `Authorization: Bearer vcu_…`, the token
 * `versioncam cloud login` was given.
 */

/** Who can see a project's clips: the dashboard's three words. */
export type Visibility = "public" | "unlisted" | "private";

/**
 * Every refusal: a code for the command line to act on, and a sentence for
 * the person. A few carry one more field: `plan` the upgrade page's address,
 * `rate_limited` how many seconds to wait.
 */
export type CloudErrorBody = {
  error: string;
  message: string;
  upgrade?: string;
  retry_after?: number;
};

/** `POST /v1/cli/device`: the start of a sign-in, in RFC 8628's shape. */
export type DeviceAuthorization = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

/** `POST /v1/cli/token`, once the person approved: the token, shown once. */
export type DeviceToken = {
  token: string;
  login: string;
  expires_at: string;
};

/**
 * The four answers a token request gives before it gives a token, each a 400
 * with `error` set to it. The first two say to keep asking; the last two end
 * the sign-in.
 */
export type DevicePending =
  "authorization_pending" | "slow_down" | "expired_token" | "access_denied";

/** `GET /v1/me`: who the token is, and every project they may see. */
export type Me = {
  login: string;
  accounts: {
    login: string;
    /** Null when the dashboard would not show this person the account's plan. */
    plan: { name: string; title: string } | null;
    projects: {
      project: string;
      visibility: Visibility;
      clips: number;
      broken: number;
    }[];
  }[];
};

/** What plays at a clip's living address: the newest version that passed. */
export type Plays = { version: string; commit: string; recordedAt: string };

/** Who said "I know, keep the old one", and when. */
export type Acknowledgment = { by: string; at: string };

/** One clip in a project's status. */
export type ClipStatus = {
  clip: string;
  title: string;
  status: "current" | "broken";
  brokenSince: string | null;
  acknowledged: Acknowledgment | null;
  plays: Plays | null;
  checkedAt: string | null;
  /** The living address; signed for an hour on a private project. */
  url: string;
};

/** `GET /v1/projects/:owner/:repo`. */
export type ProjectStatus = {
  project: string;
  /** The project's page on the dashboard. */
  manage: string;
  visibility: Visibility;
  /** "Tell viewers when a clip is broken". */
  showBroken: boolean;
  permission: "admin" | "read";
  plan: { name: string; title: string; alerts: boolean };
  /** Who is told when a clip breaks: for someone who may change the project, else null. */
  alerts: {
    email: string | null;
    emailConfirmed: boolean;
    slack: boolean;
    issues: boolean;
  } | null;
  /** This month's. */
  usage: { publishes: number; renderSeconds: number; storageBytes: number };
  clips: ClipStatus[];
};

/** Where a clip's check stopped, the last time it failed on the default branch. */
export type ClipFailure = {
  since: string;
  commit: string;
  step: { index: number; call: string } | null;
  message: string;
  /** The page when the run gave up; signed for an hour on a private project. */
  picture: string | null;
};

/** `GET /v1/projects/:owner/:repo/clips/:clip`. */
export type ClipDetail = {
  clip: string;
  title: string;
  status: "current" | "broken";
  /** The living address; signed for an hour on a private project. */
  url: string;
  /**
   * What the clip's page offers to paste, or null while nothing of the clip
   * has passed on the default branch, when there is nothing to embed.
   * `video` is null when the version has no MP4.
   */
  embed: {
    script: string;
    iframe: string;
    video: string | null;
    markdown: string;
  } | null;
  /** Signed for an hour on a private project, the GIF's too; null as `embed` is. */
  files: {
    mp4: string | null;
    webm: string | null;
    poster: string | null;
    sheet: string | null;
    gif: string | null;
  } | null;
  failure: ClipFailure | null;
};

/** `GET /v1/accounts/:login/plan`. */
export type AccountPlan = {
  account: string;
  plan: {
    name: string;
    title: string;
    source: "free" | "beta" | "subscription" | "override";
    until: string | null;
    quantity: number | null;
  };
  upgrade: string;
  /** The billing page, for someone who may bill the account; else null. */
  billing: string | null;
};

/** `POST …/clips/:clip/ack`. */
export type Acknowledged = { acknowledged: Acknowledgment };

/**
 * A change to one setting, exactly one of these fields. Each is what the
 * dashboard's settings form takes for the same setting; `retentionDays: null`
 * keeps every version the plan allows, as the form's empty field does.
 */
export type ChangeRequest =
  | { visibility: Visibility }
  | { retentionDays: number | null }
  | { showBroken: boolean }
  | { alertEmail: string | null }
  | { slackWebhook: string | null }
  | { staleIssues: boolean };

/** `POST …/changes`: the change waits for the person to approve it. */
export type ChangePending = {
  change: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  /** The change in a sentence, as the approval page shows it. */
  describe: string;
};

/** `GET …/changes/:change`. */
export type ChangeState = {
  state: "pending" | "applied" | "denied" | "expired";
};

/** Paths, relative to the API's origin. Names are escaped: a clip id may hold a dot. */
export const CLOUD_PATHS = {
  device: "/v1/cli/device",
  token: "/v1/cli/token",
  me: "/v1/me",
  project: (project: string) => `/v1/projects/${projectPath(project)}`,
  clip: (project: string, clip: string) =>
    `/v1/projects/${projectPath(project)}/clips/${encodeURIComponent(clip)}`,
  ack: (project: string, clip: string) =>
    `/v1/projects/${projectPath(project)}/clips/${encodeURIComponent(clip)}/ack`,
  changes: (project: string) => `/v1/projects/${projectPath(project)}/changes`,
  change: (project: string, change: string) =>
    `/v1/projects/${projectPath(project)}/changes/${encodeURIComponent(change)}`,
  plan: (account: string) => `/v1/accounts/${encodeURIComponent(account)}/plan`,
} as const;

/** `owner/repo` as two path segments, each escaped on its own. */
function projectPath(project: string): string {
  const [owner, repo] = project.split("/");
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}
