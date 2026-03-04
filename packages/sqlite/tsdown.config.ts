import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/testing.ts"],
  dts: { eager: true },
  sourcemap: true,
  outputOptions: {
    minifyInternalExports: false,
  },
  exports: {
    devExports: true,
  },
  // TODO: rework later
  external: ["vitest", "better-sqlite3"],
});
