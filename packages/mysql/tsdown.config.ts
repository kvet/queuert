import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/conformance.ts", "./src/conformance-internal.ts"],
  dts: true,
  sourcemap: true,
  outputOptions: {
    minifyInternalExports: false,
  },
  exports: {
    devExports: true,
  },
  deps: {
    neverBundle: ["vitest", "mysql2", "@queuert/testcontainers"],
  },
});
