import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The names this process took from `.env.recording` or `.env`, as opposed to
 * inheriting from the shell that ran it.
 *
 * Kept because the two kinds go to different places. The recorder's own
 * sign-in hook reads the files' values; the app's dev server, which the
 * recorder may now start itself, must not see them. The recording credentials
 * are the reason `.env.recording` is a separate file at all, and Vite gives a
 * variable already in its environment priority over the app's own `.env` —
 * so a value the recorder loaded for itself would quietly change how the app
 * it is filming behaves.
 */
const fromFiles = new Set<string>();

/**
 * Load `.env.recording`, then `.env`, before anything reads the environment.
 *
 * Two files because the credentials a recording uses are usually not the ones
 * the app's own `.env` carries, and keeping them apart means the recording
 * file can hold a session token without that leaking into how the app runs.
 * Neither overrides a variable the shell already set.
 */
export function loadEnvFiles(cwd: string): void {
  for (const name of [".env.recording", ".env"]) {
    const file = resolve(cwd, name);
    if (!existsSync(file)) continue;
    const before = new Set(Object.keys(process.env));
    process.loadEnvFile(file);
    for (const key of Object.keys(process.env)) {
      if (!before.has(key)) fromFiles.add(key);
    }
  }
}

/** `process.env` as the shell handed it over: what a child should inherit. */
export function inheritedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !fromFiles.has(key)),
  );
}
