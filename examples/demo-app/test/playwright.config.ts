import { defineConfig } from "@playwright/test";

/**
 * The example app's own integration test.
 *
 * It needs the app actually running, unlike the package's tests, which serve
 * their fixtures from a route table. `reuseExistingServer` is unconditional
 * because CI starts the app itself, before the clips are checked, and a second
 * Vite on a strict port would simply fail.
 */
export default defineConfig({
  testDir: ".",
  // Recording the same clip twice, three times over, is not a two-minute job
  // on a cold CI runner.
  timeout: 10 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5174/",
    reuseExistingServer: true,
    timeout: 60_000,
    cwd: "..",
  },
});
