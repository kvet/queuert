import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/internal.ts", "./src/testing.ts", "./src/conformance.ts"],
  dts: true,
  sourcemap: true,
  outputOptions: {
    minifyInternalExports: false,
  },
  exports: {
    devExports: true,
  },
  deps: {
    neverBundle: ["vitest"],
  },
});
