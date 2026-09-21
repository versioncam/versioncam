import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../src/config";
import type { RecorderConfig, ResolvedConfig } from "../src/config";

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(TEST_DIR, "fixtures");

/** The origin the fixture app is served on; nothing resolves it. */
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

/** The checked-in recording of the fixture page, for render tests. */
export const FIXTURE_RECORDING = resolve(FIXTURES, "recording-buttons");
