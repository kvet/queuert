import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/internal.ts", "./src/testing.ts"],
  dts: true,
  sourcemap: true,
  exports: {
    devExports: true,
  },
  // TODO: rework later
  external: ["vitest"],
});
