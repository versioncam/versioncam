import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { resolveConfig } from "../src/config";
import type { RecorderConfig, ResolvedConfig } from "../src/config";

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(TEST_DIR, "fixtures");

/** The origin the fixture app is served on. Nothing resolves it. */
export const FIXTURE_ORIGIN = "http://fixture.local";

/**
 * A config rooted in a throwaway directory, so a test never writes into the
 * repository and two tests never share an output path.
 */
export function testConfig(
  overrides: Partial<RecorderConfig> = {},
): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), "living-demos-"));
  return resolveConfig(
    {
      baseUrl: FIXTURE_ORIGIN,
      viewport: { width: 1000, height: 700 },
      dpr: 2,
      fps: 60,
      ...overrides,
    },
    root,
  );
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

/**
 * Serve the fixture page to the page being recorded.
 *
 * Installed from inside a clip's body via `offCamera`, which is the same seam
 * an app uses to mock its own API — so the test exercises the mechanism a
 * consumer will actually use rather than a private one.
 */
export async function installFixtureRoutes(page: Page): Promise<void> {
  await page.route(`${FIXTURE_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(FIXTURES, path === "/" ? "buttons.html" : path.slice(1));
    try {
      await route.fulfill({
        status: 200,
        contentType: TYPES[extname(file).toLowerCase()] ?? "text/plain",
        body: await readFile(file),
      });
    } catch {
      await route.fulfill({ status: 404, body: `no fixture at ${path}` });
    }
  });
}

/** The checked-in recording of the fixture page, for render tests. */
export const FIXTURE_RECORDING = resolve(FIXTURES, "recording-buttons");
