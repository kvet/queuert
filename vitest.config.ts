import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "packages-internal/typed-sql", "examples/*"],
  },
});
