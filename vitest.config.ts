import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "packages-internal/helpers",
      "packages-internal/typed-sql",
      "examples/*",
    ],
  },
});
