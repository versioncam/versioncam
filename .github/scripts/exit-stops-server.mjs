#!/usr/bin/env node
/**
 * Starts an app's server, then exits without stopping it.
 *
 * The one way out of a command that no test reaches: the `exit` handler in
 * `app-server.ts`, for a process that ends while the server is still up. On
 * Windows that handler is the only caller of taskkill that cannot wait for
 * anything, so CI runs this and then asks, from a process of its own, whether
 * the port is free (`port-free.mjs`). A test could not ask: it would have to
 * end the process that is asking.
 *
 * Usage: node .github/scripts/exit-stops-server.mjs <port>
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureApp } from "../../packages/recorder/dist/app-server.js";
import { resolveConfig } from "../../packages/recorder/dist/config.js";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write("Usage: exit-stops-server.mjs <port>\n");
  process.exit(2);
}

const server =
  `require('http').createServer((q, s) => s.end('ok'))` +
  `.listen(${port}, '127.0.0.1')`;
const config = resolveConfig(
  {
    baseUrl: `http://127.0.0.1:${port}`,
    webServer: {
      command: `"${process.execPath}" -e "${server}"`,
      // A server found here was not started here, and proves nothing.
      reuseExistingServer: false,
    },
  },
  mkdtempSync(join(tmpdir(), "versioncam-exit-")),
);

const app = await ensureApp(config);
process.stdout.write(`${app.detail}\n`);
// On purpose: no `app.stop()`. This is the way out being tested.
process.exit(0);
