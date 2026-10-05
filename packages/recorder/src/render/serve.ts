import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import type { Page } from "playwright";
import type { RenderConfig } from "../config.js";

/**
 * Serves the render page, the recording and the app's scenes from memory.
 *
 * Rendering deliberately does not need the app's dev server running. It needs
 * a recording on disk and a browser; anything else is a dependency on the
 * customer's environment for no benefit — and in the prototype it was worse
 * than neutral, because a dev server pushed a reload into the page mid-render
 * whenever a file changed.
 *
 * The origin is fake. Nothing resolves it; every request for it is answered
 * here, and every request for anywhere else is refused here.
 */
export const RENDER_ORIGIN = "http://versioncam.local";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function contentType(path: string): string {
  return (
    CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}

/**
 * Join a URL path onto a directory without letting it escape.
 *
 * The paths come from our own page, but a route handler that can read any file
 * by URL is the kind of thing that later grows into a hosted service.
 */
function safeJoin(root: string, urlPath: string): string | null {
  const relative = normalize(decodeURIComponent(urlPath)).replace(
    /^([/\\])+/,
    "",
  );
  const full = resolve(root, relative);
  const rootWithSep = resolve(root) + sep;
  return full === resolve(root) || full.startsWith(rootWithSep) ? full : null;
}

export type ServeOptions = {
  /** The built render page: `dist/render`. */
  distDir: string;
  renderConfig: RenderConfig;
  /** A recording directory, when rendering one. */
  recordingDir?: string;
  /** A browser-format ESM bundle of the app's scenes, when it has any. */
  scenesBundle?: string;
};

/**
 * Answer the page's requests from memory, and refuse everything else.
 *
 * The page needs nothing but its own origin, so a request for any other is
 * a mistake or an attack, never a dependency: version.cam renders other
 * people's recordings with this page, on a machine where the renderer
 * itself listens on a local port and an internal API answers. So every
 * request is routed here, and one for another origin is aborted before it
 * leaves the browser. Chromium's own checks are not the boundary: they
 * stopped a fetch from this page to loopback, but not a WebSocket, and not
 * a request to a host whose address they class as public. A WebSocket is
 * not a request that routes see, so it has a route of its own, which closes
 * every one without connecting it.
 */
export async function installRenderRoutes(
  page: Page,
  options: ServeOptions,
): Promise<void> {
  await page.routeWebSocket("**", (socket) => socket.close());
  await page.route("**", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== RENDER_ORIGIN) {
      await route.abort("blockedbyclient");
      return;
    }
    const path = url.pathname;

    if (path === "/render-config.json") {
      await route.fulfill({
        status: 200,
        contentType: CONTENT_TYPES[".json"],
        body: JSON.stringify(options.renderConfig),
      });
      return;
    }

    if (path === "/scenes.js") {
      if (!options.scenesBundle) {
        await route.fulfill({ status: 404, body: "no scenes configured" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: CONTENT_TYPES[".js"],
        body: await readFile(options.scenesBundle, "utf8"),
      });
      return;
    }

    if (path.startsWith("/recording/")) {
      if (!options.recordingDir) {
        await route.fulfill({ status: 404, body: "no recording loaded" });
        return;
      }
      const file = safeJoin(
        options.recordingDir,
        path.slice("/recording".length),
      );
      if (!file) {
        await route.fulfill({
          status: 403,
          body: "path escapes the recording",
        });
        return;
      }
      await fulfillFile(route, file);
      return;
    }

    // Everything else is the built page: "/" and its hashed assets.
    const relative = path === "/" ? "index.html" : path;
    const file = safeJoin(options.distDir, relative);
    if (!file) {
      await route.fulfill({ status: 403, body: "path escapes the bundle" });
      return;
    }
    await fulfillFile(route, file);
  });
}

async function fulfillFile(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
  file: string,
): Promise<void> {
  try {
    await route.fulfill({
      status: 200,
      contentType: contentType(file),
      body: await readFile(file),
    });
  } catch {
    await route.fulfill({ status: 404, body: `not found: ${file}` });
  }
}

/**
 * Where the built render page lives.
 *
 * Found by walking up to the package root rather than by counting `..`
 * segments, because this module runs from two places: `dist/render/serve.js`
 * when a consumer uses the CLI, and `src/render/serve.ts` when the package's
 * own tests import it directly. A relative guess is right in one and silently
 * 404s in the other.
 */
export function distPageDir(): string {
  let dir = import.meta.dirname;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return join(dir, "dist", "page");
    dir = dirname(dir);
  }
  throw new Error(
    "Could not locate the recorder package root from " + import.meta.dirname,
  );
}
