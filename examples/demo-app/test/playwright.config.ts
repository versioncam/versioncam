import { defineConfig } from "@playwright/test";

/**
 * The example app's own integration test.
 *
 * It needs the app actually running, unlike the package's tests, which serve
 * their fixtures from a route table — and it gets it the way every command
 * does, from `webServer` in the app's `versioncam.config.ts`, through
 * `withApp`. Playwright's own `webServer` used to start it here instead; the
 * two cannot both hold the port, and in CI, where an already-running server is
 * refused rather than reused, the second would fail on the first.
 */
export default defineConfig({
  testDir: ".",
  // Recording the same clip twice, three times over, is not a two-minute job
  // on a cold CI runner.
  timeout: 10 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
