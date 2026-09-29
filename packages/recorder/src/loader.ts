import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig } from "./config.js";
import type { RecorderConfig, ResolvedConfig } from "./config.js";
import type { ClipDefinition } from "./driver/clip.js";
import { readScenes } from "./render/scenes.js";

/**
 * Loads the TypeScript an app writes: its config, its clips, its scenes.
 *
 * One mechanism for all three, which is esbuild. Node's native type stripping
 * was the tempting alternative — no dependency at all — but it requires
 * explicit `.ts` extensions on every relative import, which is not how anyone
 * writes an import, and it would pin apps to a Node minor. A bundler also
 * gives the scenes their browser build for free, which they need anyway.
 */

const CACHE_VERSION = 1;

export async function bundleModule(
  entry: string,
  platform: "node" | "browser",
  cacheDir: string,
): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const key = createHash("sha1")
    .update(`${CACHE_VERSION}:${platform}:${entry}`)
    .digest("hex")
    .slice(0, 12);
  const outfile = join(cacheDir, `${basename(entry, ".ts")}.${key}.mjs`);

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform,
    target: "es2023",
    sourcemap: "inline",
    logLevel: "silent",
    // Node builds keep their imports live so a clip gets the same package
    // instance the CLI is running, and the same Playwright.
    external:
      platform === "node"
        ? ["versioncam", "versioncam/*", "playwright", "node:*"]
        : [],
  });

  return outfile;
}

/** Import a bundle fresh, defeating the ESM module cache between runs. */
export async function importFresh<T>(file: string): Promise<T> {
  const url = `${pathToFileURL(file).href}?t=${Date.now()}`;
  return (await import(url)) as T;
}

const CONFIG_NAMES = [
  "versioncam.config.ts",
  "versioncam.config.js",
  "versioncam.config.mjs",
];

/**
 * What to do about a missing config, wherever one is found missing.
 *
 * It is the first thing someone new meets — `doctor` in a fresh app, or any
 * command run before the skill has — and the skill's first run writes a
 * better config than a person starting from the type would, so that comes
 * first; by hand is the way for anyone not using the skill.
 */
export const NO_CONFIG =
  "`npx versioncam init`, then `/versioncam`: its first run writes one from the repository.\n" +
  "Or by hand: a default export from defineRecorder(), as in the README's Configure section.";

export function findConfigFile(cwd: string): string | null {
  for (const name of CONFIG_NAMES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const file = findConfigFile(cwd);
  if (!file) {
    throw new Error(`No versioncam.config.ts in ${cwd}.\n${NO_CONFIG}`);
  }
  // The cache directory comes from the config we have not read yet, so the
  // bundle goes next to the config until we know better.
  const bootstrapCache = resolve(dirname(file), ".versioncam", ".cache");
  const bundle = await bundleModule(file, "node", bootstrapCache);
  const module = await importFresh<{ default?: RecorderConfig }>(bundle);
  if (!module.default) {
    throw new Error(
      `${file} must have a default export from defineRecorder().`,
    );
  }
  return resolveConfig(module.default, dirname(file));
}

/**
 * Every clip the config points at, in file order.
 *
 * `only` filters by substring against the clip id, which is how
 * `versioncam record 05` works: an id is long and nobody wants to type one in
 * full.
 */
export async function loadClips(
  config: ResolvedConfig,
  only: string[] = [],
): Promise<ClipDefinition[]> {
  const { glob } = await import("node:fs/promises");
  const files: string[] = [];
  for (const pattern of config.clips) {
    for await (const match of glob(pattern, { cwd: config.root })) {
      files.push(resolve(config.root, match));
    }
  }
  files.sort();

  const clips: ClipDefinition[] = [];
  for (const file of files) {
    const bundle = await bundleModule(file, "node", config.cacheDir);
    const module = await importFresh<{
      default?: ClipDefinition | ClipDefinition[];
    }>(bundle);
    if (!module.default) {
      throw new Error(
        `${file} must default-export a clip (or an array of them).`,
      );
    }
    for (const clip of [module.default].flat()) {
      if (typeof clip?.id !== "string" || typeof clip?.body !== "function") {
        throw new Error(
          `${file} default-exports something that is not a clip.`,
        );
      }
      clips.push(clip);
    }
  }

  const seen = new Set<string>();
  for (const clip of clips) {
    if (seen.has(clip.id)) {
      throw new Error(`Two clips share the id "${clip.id}".`);
    }
    seen.add(clip.id);
  }

  return only.length === 0
    ? clips
    : clips.filter((clip) => only.some((needle) => clip.id.includes(needle)));
}

/** The config's scenes module, or null when it names none. */
function scenesFile(config: ResolvedConfig): string | null {
  if (!config.scenes) return null;
  if (!existsSync(config.scenes)) {
    throw new Error(
      `versioncam config: \`scenes\` points at a missing file: ${config.scenes}`,
    );
  }
  return config.scenes;
}

/** The app's scenes, bundled for the browser. Null when it has none. */
export async function bundleScenes(
  config: ResolvedConfig,
): Promise<string | null> {
  const file = scenesFile(config);
  return file ? bundleModule(file, "browser", config.cacheDir) : null;
}

/**
 * Scene ids, without running a browser: needed to list and to filter.
 *
 * Reading them is also the check that the module exports its scenes where
 * the render page will look for them. A module that does not is refused here,
 * before anything renders, rather than left out of the output unremarked.
 */
export async function loadSceneIds(config: ResolvedConfig): Promise<string[]> {
  const file = scenesFile(config);
  if (!file) return [];
  const bundle = await bundleModule(file, "node", config.cacheDir);
  const read = readScenes(
    await importFresh<Record<string, unknown>>(bundle),
    file,
  );
  if ("error" in read) throw new Error(read.error);
  return Object.keys(read.scenes);
}
