import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/testing.ts"],
  dts: { eager: true },
  sourcemap: true,
  exports: {
    devExports: true,
  },
  // TODO: rework later
  external: ["vitest", "pg", "@queuert/testcontainers"],
});
