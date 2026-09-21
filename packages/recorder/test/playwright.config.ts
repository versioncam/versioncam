import { defineConfig } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The package's own integration tests.
 *
 * No `webServer`: every page these tests drive is served from the route table
 * the recorder installs, so the suite runs on a clean checkout with nothing
 * else started. That is the point — it is also how a consumer's `demos render`
 * works.
 */
export default defineConfig({
  testDir: dirname(fileURLToPath(import.meta.url)),
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 5 * 60 * 1000,
  expect: { timeout: 15_000 },
  use: { trace: "off", video: "off", screenshot: "off" },
});
