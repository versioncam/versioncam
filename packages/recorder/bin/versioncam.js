#!/usr/bin/env node
/**
 * A committed launcher for the CLI.
 *
 * `bin` cannot point straight at `dist/cli/main.js`: npm creates a bin symlink
 * only when its target already exists, and on a fresh checkout the package is
 * installed before it is built. The link is then silently absent and
 * `versioncam` is not a command — which is exactly the shape the failure took
 * in CI.
 *
 * This file always exists, so the link is always made, and it defers to the
 * build at run time.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "main.js");

if (!existsSync(entry)) {
  process.stderr.write(
    "versioncam has not been built: no dist/cli/main.js.\n" +
      "Run `npm run build` in the package (or reinstall a published version).\n",
  );
  process.exit(1);
}

await import(entry);
