/**
 * The publish protocol: what `versioncam publish` sends to version.cam, and
 * what comes back.
 *
 * Both ends import this file. The recorder builds a publish from it and the
 * service validates one against it, through `versioncam/publish`, an entry
 * that pulls in nothing that needs Node. A field added on one side is a type
 * error on the other until both agree, which is the only kind of protocol
 * drift that cannot reach production.
 *
 * The shape follows what a recording is on disk. A recording is a timeline
 * plus a directory of distinct states, so a publish is a timeline plus the
 * states' content hashes: the service asks for the states it has never seen,
 * and a version that changed one screen uploads one screen.
 */

/** Bumped when either side could misread the other. */
export const PUBLISH_PROTOCOL = 1;

/** Where the service is, unless `VERSIONCAM_API` says otherwise. */
export const DEFAULT_API = "https://api.version.cam";

/**
 * The audience a GitHub OpenID Connect token must be minted for. The Action
 * asks for exactly this, and the service refuses any other, so a token
 * minted for some other service cannot be replayed here.
 */
export const OIDC_AUDIENCE = "version.cam";

/**
 * Limits that hold on every plan. The service enforces them; they are here so
 * the client can say which one a recording breaks before uploading anything.
 */
export const HARD_CAPS = {
  statesPerVersion: 400,
  stateBytes: 4 * 1024 * 1024,
  timelineBytes: 2 * 1024 * 1024,
  targetsBytes: 256 * 1024,
  failureBytes: 4 * 1024 * 1024,
  publishesPerHour: 20,
} as const;

/** The step that was running when a clip failed: its index and its call. */
export type FailedStep = { index: number; call: string };

/** What the last run of a clip said about it. */
export type CheckResult =
  | { status: "pass" }
  | {
      status: "fail";
      message: string;
      step: FailedStep | null;
      frame: number;
      t: number;
    };

/** One distinct state: a PNG, by the SHA-256 of its bytes. */
export type StateRef = {
  hash: string;
  bytes: number;
  width: number;
  height: number;
};

/**
 * What the service needs to render a recording exactly as `versioncam render`
 * would have: the render page's config without its scenes (a scenes module is
 * the app's own code, and nothing runs an app's code but the app's own CI),
 * and the clock the render page is opened with.
 */
export type PublishedRenderConfig = {
  output: { width: number; height: number };
  theme: {
    accent: string;
    cursorScale: number;
    /** The config's `theme.presentation`, or null when it is off. */
    presentation: Record<string, unknown> | null;
  };
  /** The config's motion, every default filled in. */
  motion: Record<string, unknown>;
  clock: { timezoneId: string; locale: string };
};
// Written out rather than derived from the config's types, so that the
// service, which imports this file, never reaches the config module and the
// Node it needs. `manifest.ts` builds one from the real config, and the
// compiler checks the two agree there.

/** A complete recording, described without its bytes. */
export type RecordingManifest = {
  /**
   * The SHA-256 of what makes this recording look the way it does: the
   * timeline without the fields that change on every run (when it was
   * recorded, the app's commit), the states' hashes in order, the targets
   * and the render config. Two runs that would render the same bytes have
   * the same content hash, which is how the service knows a version is
   * unchanged since the last one without being sent it.
   */
  contentHash: string;
  /** The SHA-256 of `timeline.json` exactly as it will be uploaded. */
  timelineHash: string;
  timelineBytes: number;
  /** The SHA-256 of `targets.json`, or null for a recording without one. */
  targetsHash: string | null;
  /** Recorded with `--draft`: 15 frames a second, at CSS scale. */
  draft: boolean;
  fps: number;
  durationFrames: number;
  viewport: { width: number; height: number; dpr: number };
  /** Every state the timeline names, in the timeline's order. */
  states: StateRef[];
  renderConfig: PublishedRenderConfig;
};

/** One clip in a publish: its last check, and its recording if it passed. */
export type ClipManifest = {
  id: string;
  title: string;
  check: CheckResult;
  /** Present when the check passed and the recording is complete. */
  recording: RecordingManifest | null;
  /** The SHA-256 of `failure.png`, when the check failed and left one. */
  failureHash: string | null;
};

/**
 * The first request of a publish.
 *
 * With a GitHub OpenID Connect token, the repository, commit, ref and run
 * come from the token and these fields are checked against it: what the
 * player says a clip was recorded against is GitHub's word, not the CLI's.
 * With a project token they are the only word there is.
 */
export type PublishBegin = {
  protocol: typeof PUBLISH_PROTOCOL;
  /** The versioncam version that made the recordings. */
  recorder: string;
  /** `owner/repo`. Optional with a project token, which names its project. */
  project: string | null;
  commit: string;
  branch: string;
  ref: string;
  runId: string | null;
  clips: ClipManifest[];
};

/** A clip the service will not take a recording of, and why, in a sentence. */
export type Refusal = { clip: string; reason: string };

export type PublishBeginResponse = {
  publishId: string;
  /** `owner/repo`, as the service knows the project. */
  project: string;
  needStates: string[];
  needTimelines: string[];
  needTargets: string[];
  needFailures: string[];
  /**
   * Recordings refused, by a cap or a plan. Their check results are recorded
   * all the same: a limit gates storage and renders, never the truth.
   */
  refused: Refusal[];
};

/** What a publish made, per clip. */
export type PublishedVersion = {
  clip: string;
  version: string;
  /** The living URL of the clip on this branch. */
  url: string;
  /** This version's own page. */
  versionUrl: string;
  check: "pass" | "fail";
  /** Nothing about how it looks changed since the version before it. */
  unchanged: boolean;
  /** The clip is stale on the default branch after this publish. */
  stale: boolean;
  /** Why its recording was not stored, when it was not. */
  refused: string | null;
};

export type PublishCommitResponse = {
  project: string;
  versions: PublishedVersion[];
};

/** Every error the service answers with has a sentence meant for a person. */
export type PublishErrorBody = { error: string; code: string };

/** Paths, relative to the API's origin. */
export const PUBLISH_PATHS = {
  begin: "/v1/publish/begin",
  state: (id: string, hash: string) => `/v1/publish/${id}/state/${hash}`,
  timeline: (id: string, clip: string) =>
    `/v1/publish/${id}/timeline/${encodeURIComponent(clip)}`,
  targets: (id: string, clip: string) =>
    `/v1/publish/${id}/targets/${encodeURIComponent(clip)}`,
  failure: (id: string, clip: string) =>
    `/v1/publish/${id}/failure/${encodeURIComponent(clip)}`,
  commit: (id: string) => `/v1/publish/${id}/commit`,
} as const;

/**
 * The timeline as its content hash sees it: without when it was recorded or
 * which commit of the app it ran against, which differ on every run and say
 * nothing about what the recording shows.
 */
export function contentOfTimeline(timeline: {
  meta: Record<string, unknown>;
}): unknown {
  const {
    recordedAt: _recordedAt,
    appCommit: _appCommit,
    ...meta
  } = timeline.meta;
  return { ...timeline, meta };
}
