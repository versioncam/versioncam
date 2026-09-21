import { defineConfig } from "vitest/config";

// One runner for every package: the unit tests are pure and have no reason to
// be split across per-package configs.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    silent: true,
  },
});
