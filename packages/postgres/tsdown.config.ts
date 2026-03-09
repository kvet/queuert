import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/testing.ts"],
  dts: true,
  sourcemap: true,
  outputOptions: {
    minifyInternalExports: false,
  },
  exports: {
    devExports: true,
  },
  // TODO: rework later
  external: ["vitest", "pg", "@queuert/testcontainers"],
});
