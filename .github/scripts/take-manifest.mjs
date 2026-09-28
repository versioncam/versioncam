// Gathers what version.cam's front page needs to show the example's takes
// truthfully, into one directory for CI to upload beside the videos:
//
//   <id>.timeline.json  the recording's own timeline: its steps, and the
//                       versioncam version that made it
//   <id>.clip.ts        the script that recorded it
//   check.txt           this run's `versioncam check`, as it printed
//   manifest.json       the commit, when, the recorder, and each clip's
//                       length and how many of its frames were captured
//
// Usage: node .github/scripts/take-manifest.mjs <app dir> <out dir>
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [app, out] = process.argv.slice(2);
if (!app || !out) {
  console.error("usage: take-manifest.mjs <app dir> <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const recordings = join(app, ".versioncam", "recordings");
const clips = [];
for (const id of readdirSync(recordings).sort()) {
  // Stability and gate runs keep their recordings under `__` directories.
  const timelineFile = join(recordings, id, "timeline.json");
  if (id.startsWith("__") || !existsSync(timelineFile)) continue;
  const source = join(app, "demos", "clips", `${id}.clip.ts`);
  const timeline = JSON.parse(readFileSync(timelineFile, "utf8"));
  copyFileSync(timelineFile, join(out, `${id}.timeline.json`));
  if (existsSync(source)) copyFileSync(source, join(out, `${id}.clip.ts`));
  clips.push({
    id,
    title: timeline.meta.title,
    fps: timeline.fps,
    frames: timeline.durationFrames,
    captured: timeline.meta.captured ?? null,
    seconds: Number((timeline.durationFrames / timeline.fps).toFixed(2)),
    source: existsSync(source),
  });
}

const check = join(app, ".versioncam", "check.txt");
if (existsSync(check)) copyFileSync(check, join(out, "check.txt"));

const { version } = JSON.parse(readFileSync(join("packages", "recorder", "package.json"), "utf8"));
const manifest = {
  commit: (process.env.GITHUB_SHA ?? "").slice(0, 7) || null,
  recordedAt: new Date().toISOString(),
  recorder: version,
  check: existsSync(check),
  clips,
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`take: ${clips.length} clips, recorder ${version}, commit ${manifest.commit ?? "local"}`);
