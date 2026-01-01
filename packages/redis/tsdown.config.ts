import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/testing.ts"],
  dts: true,
  sourcemap: true,
  exports: {
    devExports: true,
  },
  external: ["vitest", "redis"],
});
