import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "packages-internal/*",
      "examples/*/vitest.config.ts",
      "examples/*/*/vitest.config.ts",
      "docs",
    ],
  },
});
