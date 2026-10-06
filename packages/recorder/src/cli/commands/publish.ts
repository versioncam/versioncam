import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { RECORDER_VERSION } from "../../driver/clip.js";
import { loadClips, loadConfig } from "../../loader.js";
import {
  publishRecordings,
  PublishRefused,
  type PublishFiles,
} from "../../publish/client.js";
import {
  publishedRenderConfig,
  readClip,
  type RecordingFiles,
} from "../../publish/manifest.js";
import {
  DEFAULT_API,
  PUBLISH_PROTOCOL,
  type ClipManifest,
  type PublishBegin,
  type PublishBeginResponse,
  type PublishCommitResponse,
  type PublishedVersion,
} from "../../publish/protocol.js";

/**
 * Send the recordings, and what their last run said, to version.cam.
 *
 * It records nothing and renders nothing. It reads what `check`, `record` or
 * `stability` left in the recordings directory, for the clips the config
 * defines today (a recording of a clip since renamed or deleted is left
 * behind), and publishes each one's latest word: a complete recording that
 * passed, or the failure that stopped it. The service renders the rest.
 *
 * The credential comes from the environment, never from a flag, so it
 * cannot end up in a shell history or a CI log line:
 * `VERSIONCAM_OIDC_TOKEN` is the GitHub token the Action requests, and
 * `VERSIONCAM_TOKEN` is a project token, for a repository outside GitHub:
 * a repository on GitHub publishes with GitHub's token, whatever CI builds
 * it, because only that token can say which repository a run is of.
 */
export async function publish(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      report: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });
  const ids = positionals as string[];
  const dryRun = values["dry-run"] === true;
  const reportPath =
    typeof values.report === "string" ? resolve(values.report) : null;

  const config = await loadConfig(process.cwd());
  const clips = await loadClips(config);
  const unknown = ids.filter((id) => !clips.some((clip) => clip.id === id));
  if (unknown.length > 0) {
    process.stderr.write(
      `No clip is called ${unknown.join(", ")}. The clips are: ${clips.map((c) => c.id).join(", ") || "none"}.\n`,
    );
    return 1;
  }

  const renderConfig = publishedRenderConfig(config);
  const manifests: ClipManifest[] = [];
  const files = new Map<string, RecordingFiles>();
  const unrecorded: string[] = [];
  for (const clip of clips) {
    if (ids.length > 0 && !ids.includes(clip.id)) continue;
    const read = readClip(
      join(config.recordingsDir, clip.id),
      { id: clip.id, title: clip.options.title ?? "" },
      renderConfig,
    );
    if (!read) {
      unrecorded.push(clip.id);
      continue;
    }
    manifests.push(read.manifest);
    files.set(clip.id, read.files);
  }

  if (unrecorded.length > 0) {
    process.stderr.write(
      `Not recorded here, so not published: ${unrecorded.join(", ")}. ` +
        "Run `versioncam check` or `versioncam record` first.\n",
    );
  }
  if (manifests.length === 0) {
    process.stderr.write("Nothing to publish.\n");
    return 1;
  }

  const where = provenance(config.root);
  const begin: PublishBegin = {
    protocol: PUBLISH_PROTOCOL,
    recorder: RECORDER_VERSION,
    project: process.env.GITHUB_REPOSITORY ?? null,
    ...where,
    clips: manifests,
  };

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(begin, null, 2)}\n`);
    return 0;
  }

  const credential =
    process.env.VERSIONCAM_OIDC_TOKEN || process.env.VERSIONCAM_TOKEN;
  if (!credential) {
    process.stderr.write(
      "publish needs a credential in the environment: VERSIONCAM_OIDC_TOKEN, " +
        "which the versioncam Action requests from GitHub, or VERSIONCAM_TOKEN, " +
        "a project token from version.cam, for a repository outside GitHub.\n",
    );
    return 1;
  }
  const api = process.env.VERSIONCAM_API || DEFAULT_API;

  try {
    const { begun, committed } = await publishRecordings(
      begin,
      filesFor(files),
      {
        api,
        credential,
        log: (line) => process.stdout.write(`${line}\n`),
      },
    );
    process.stdout.write(`Published to ${api} as ${committed.project}:\n`);
    for (const version of committed.versions) {
      process.stdout.write(`  ${versionLine(version)}\n`);
    }
    for (const refusal of begun.refused) {
      process.stderr.write(`  ${refusal.clip}: ${refusal.reason}\n`);
    }
    if (reportPath) {
      writeReport(reportPath, publishedReport(api, begun, committed));
    }
    return 0;
  } catch (error) {
    const message =
      error instanceof PublishRefused
        ? `version.cam refused the publish: ${error.message}`
        : `publish failed: ${(error as Error).message}`;
    process.stderr.write(`${message}\n`);
    // A CI step reading the report learns what went wrong without the log.
    if (reportPath) {
      writeReport(reportPath, {
        recorder: RECORDER_VERSION,
        api,
        project: null,
        versions: [],
        refused: [],
        error: message,
      });
    }
    return 1;
  }
}

/** What a publish says of one version it made, a line each. */
export function versionLine(version: PublishedVersion): string {
  if (version.check === "fail") {
    // "Broken" where a person reads it; the protocol keeps its `stale`.
    return `${version.clip}: failed its check, ${version.stale ? "broken" : "recorded"} at ${version.versionUrl}`;
  }
  const unchanged = version.unchanged ? " (unchanged)" : "";
  const refused = version.refused ? ` (not stored: ${version.refused})` : "";
  return `${version.clip}: ${version.url}${unchanged}${refused}`;
}

/**
 * Which commit and branch these recordings are of. In GitHub Actions the
 * service reads all of this from its own token and only checks these; with a
 * project token, for a repository outside GitHub, they are the whole story,
 * so they can be set outright.
 */
function provenance(
  root: string,
): Pick<PublishBegin, "commit" | "branch" | "ref" | "runId"> {
  const env = process.env;
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  };
  const commit =
    env.VERSIONCAM_COMMIT || env.GITHUB_SHA || git("rev-parse", "HEAD");
  const branch =
    env.VERSIONCAM_BRANCH ||
    env.GITHUB_HEAD_REF ||
    env.GITHUB_REF_NAME ||
    git("rev-parse", "--abbrev-ref", "HEAD");
  const ref = env.GITHUB_REF || (branch ? `refs/heads/${branch}` : "");
  if (!commit || !branch) {
    throw new Error(
      "publish could not tell which commit and branch these recordings are of. " +
        "Run it in a git checkout, or set VERSIONCAM_COMMIT and VERSIONCAM_BRANCH.",
    );
  }
  return { commit, branch, ref, runId: env.GITHUB_RUN_ID || null };
}

function filesFor(files: Map<string, RecordingFiles>): PublishFiles {
  const statePath = (hash: string) => {
    for (const recording of files.values()) {
      const path = recording.states.get(hash);
      if (path) return path;
    }
    throw new Error(`the service asked for a state no recording has: ${hash}`);
  };
  const of = (clip: string) => {
    const recording = files.get(clip);
    if (!recording)
      throw new Error(`the service asked about an unknown clip: ${clip}`);
    return recording;
  };
  const required = (bytes: Uint8Array | null, what: string) => {
    if (!bytes)
      throw new Error(`the service asked for ${what}, which is not there`);
    return bytes;
  };
  return {
    state: async (hash) => readFile(statePath(hash)),
    timeline: async (clip) => of(clip).timeline,
    targets: async (clip) => required(of(clip).targets, `${clip}'s targets`),
    failure: async (clip) =>
      required(of(clip).failure, `${clip}'s failure picture`),
  };
}

/**
 * The report of a publish that went through: version.cam's answer, every
 * field of it, and beside it what only this side knows. The answer grows,
 * with where the project is managed, who can see its clips, or whether its
 * plan tells anyone when a clip breaks, and the Action's job summary reads
 * each field when it is there. So the answer is passed on whole, as its
 * `versions` always were, and a field the service adds reaches the summary
 * without a release of this package to carry it. This side's own fields are
 * written last, so no answer can change what they say.
 */
export function publishedReport(
  api: string,
  begun: PublishBeginResponse,
  committed: PublishCommitResponse,
): Record<string, unknown> {
  return {
    ...committed,
    recorder: RECORDER_VERSION,
    api,
    project: committed.project,
    versions: committed.versions,
    refused: begun.refused,
    error: null,
  };
}

/** Written for a machine: the Action reads it for the job summary. */
export function writeReport(path: string, report: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
