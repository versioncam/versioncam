import { browserPaths } from "./install.js";
import { ffmpegStatus } from "../../render/ffmpeg.js";
import { ensureApp, probe } from "../../app-server.js";
import type { ResolvedConfig } from "../../config.js";
import {
  NO_CONFIG,
  findConfigFile,
  loadClips,
  loadConfig,
  loadSceneIds,
} from "../../loader.js";
import { STALE_DAYS, describeReplay } from "../../driver/replay.js";

/**
 * `note` is for something absent that is not wrong: it never fails the command,
 * and it gets a mark of its own, because a tick beside "not found" reads as a
 * contradiction.
 */
type Check = {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  note?: boolean;
};

const NOT_SERVING =
  "Start the app, point `baseUrl` at where it is served, or add `webServer` to the config.";

/**
 * Is the app the config points at serving — and if not, can it be started?
 *
 * Not a property of the machine, unlike every other check here, but it is the
 * next thing that stops a recording and the cheapest one to find out about.
 * An authoring loop asks this before it writes a clip; without it the first
 * sign of a stopped dev server is a clip failing on a locator.
 *
 * With a `webServer`, this is also the rehearsal for every other command: it
 * starts the app exactly the way `record` would, reports how long that took,
 * and stops it again, so a repository finds out its start command is wrong
 * here rather than halfway into a clip. Without one, any HTTP answer at all
 * counts as up, including a 401 or a redirect — an app behind a sign-in
 * answers that way and records perfectly well.
 */
async function appCheck(cwd: string): Promise<Check> {
  let config: ResolvedConfig;
  try {
    config = await loadConfig(cwd);
  } catch (error) {
    return {
      name: "app",
      ok: false,
      detail: `config did not load: ${(error as Error).message}`,
      fix: "Fix versioncam.config.ts; every other command loads it too.",
    };
  }

  if (!config.webServer) {
    const answer = await probe(config.baseUrl);
    return answer.up
      ? {
          name: "app",
          ok: true,
          detail: `already serving at ${config.baseUrl} (HTTP ${answer.status})`,
        }
      : {
          name: "app",
          ok: false,
          detail: `${config.baseUrl}: ${answer.reason}`,
          fix: NOT_SERVING,
        };
  }

  try {
    const app = await ensureApp(config);
    await app.stop();
    return {
      name: "app",
      ok: true,
      detail: app.started ? `${app.detail} (stopped again)` : app.detail,
    };
  } catch (error) {
    // The first line says what went wrong; the rest is the server's own
    // output, which is usually where the reason is.
    const [first, ...rest] = (error as Error).message.split("\n");
    return { name: "app", ok: false, detail: first, fix: rest.join("\n") };
  }
}

/**
 * Are the app's scenes where the renderer reads them?
 *
 * Only for a config that names a scenes module. `render` refuses one whose
 * scenes are not its default export, but only once someone renders, and then
 * after the minutes that takes; this says so the first time anyone asks
 * whether the repository is set up. Null when there is nothing to say: no
 * scenes module, or a config that did not load, which the app check reports.
 */
async function scenesCheck(cwd: string): Promise<Check | null> {
  let config: ResolvedConfig;
  try {
    config = await loadConfig(cwd);
  } catch {
    return null;
  }
  if (!config.scenes) return null;

  try {
    const ids = await loadSceneIds(config);
    return {
      name: "scenes",
      ok: true,
      detail: `${config.scenes}: ${ids.join(", ") || "none defined"}`,
    };
  } catch (error) {
    // What is wrong, then the shape it should have and the fix beneath it.
    const [first, ...rest] = (error as Error).message.split("\n");
    return { name: "scenes", ok: false, detail: first, fix: rest.join("\n") };
  }
}

/**
 * Each clip's replay: whether it has one, how many requests it holds, and
 * how old it is. Never a failure: a clip without one records it on its first
 * run. Null for a config without `replay`.
 *
 * The age is the only staleness anyone can tell from here. Whether the
 * server's answers have changed since is not knowable without asking it, so
 * an old replay is pointed out, not judged.
 */
async function replayCheck(cwd: string): Promise<Check | null> {
  let config: ResolvedConfig;
  try {
    config = await loadConfig(cwd);
  } catch {
    return null;
  }
  const replay = config.replay;
  if (!replay) return null;
  let ids: string[];
  try {
    ids = (await loadClips(config, [])).map((clip) => clip.id);
  } catch (error) {
    return {
      name: "replay",
      ok: false,
      detail: `the clips did not load: ${(error as Error).message.split("\n")[0]}`,
    };
  }
  const lines = ids.map((id) => {
    const found = describeReplay(replay.dir, id);
    if (!found.exists) return `${id}: none yet; its first recording makes one`;
    const age = Number.isNaN(found.ageDays)
      ? "of unknown age"
      : `${found.ageDays} days old`;
    const stale =
      found.ageDays > STALE_DAYS
        ? ", older than any answer should be trusted to stay"
        : "";
    return `${id}: ${found.requests} requests, recorded ${found.recorded.slice(0, 10)}, ${age}${stale}`;
  });
  return {
    name: "replay",
    ok: true,
    detail: [`${replay.dir} (mode ${replay.mode})`, ...lines].join(
      "\n            ",
    ),
  };
}

/**
 * Can this machine record and encode?
 *
 * Reports every check rather than stopping at the first failure, because the
 * usual case on a new machine is that two or three things are missing at once
 * and being told about them one run at a time is tedious.
 */
export async function doctor(): Promise<number> {
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: major >= 22,
    detail: `v${process.versions.node}`,
    fix: "Install Node 22 or newer.",
  });

  // The headless shell is what records; `install` fetches it and nothing
  // else. The full browser only `login` and `preview` need, and they fetch it
  // themselves, so its absence is reported and is not a failure.
  const browsers = browserPaths();
  checks.push({
    name: "chromium",
    ok: browsers.shell !== null,
    detail: browsers.shell ?? "not installed",
    fix: "npx versioncam install",
  });
  checks.push({
    name: "window",
    ok: true,
    note: browsers.full === null,
    detail: browsers.full
      ? `full Chromium at ${browsers.full}`
      : "full Chromium not fetched yet; login and preview fetch it on first use, or `npx versioncam install --full`",
  });

  const { ffmpeg, ffprobe } = ffmpegStatus();
  checks.push({
    name: "ffmpeg",
    ok: ffmpeg !== null,
    detail: ffmpeg ?? "not found",
    fix: "brew install ffmpeg  (or apt install ffmpeg, or winget install ffmpeg)",
  });
  // Reported and never a failure. Only `render --sequence` reads it, and it has
  // its own message; `check`, `record` and a plain `render` all work without it,
  // on ffmpeg-static alone. A failure here stopped the skill, which requires
  // `doctor` to pass, on a machine that could do everything the skill asks for.
  checks.push({
    name: "ffprobe",
    ok: true,
    note: ffprobe === null,
    detail: ffprobe ?? "not found; only render --sequence needs it",
  });

  const config = findConfigFile(process.cwd());
  checks.push({
    name: "config",
    ok: config !== null,
    detail: config ?? `no versioncam.config.ts in ${process.cwd()}`,
    fix: NO_CONFIG,
  });

  // Only with a config: without one there is no `baseUrl` to try, and saying
  // so twice would be noise.
  if (config !== null) {
    const scenes = await scenesCheck(process.cwd());
    if (scenes) checks.push(scenes);
    const replay = await replayCheck(process.cwd());
    if (replay) checks.push(replay);
    checks.push(await appCheck(process.cwd()));
  }

  for (const check of checks) {
    const mark = check.note ? "-" : check.ok ? "✓" : "✗";
    process.stdout.write(`${mark} ${check.name.padEnd(9)} ${check.detail}\n`);
    if (!check.ok && check.fix) {
      for (const line of check.fix.split("\n")) {
        process.stdout.write(`            ${line}\n`);
      }
    }
  }

  const failed = checks.filter((c) => !c.ok);
  return failed.length === 0 ? 0 : 1;
}
