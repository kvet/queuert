import { syncAsyncCompiler } from "@queuert/sync-async/plugin";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/conformance.ts", "./src/conformance-internal.ts"],
  dts: true,
  plugins: [
    syncAsyncCompiler({
      exclude: /[\\/]conformance[^\\/]*[\\/]|conformance[^\\/]*$|\.spec(-helper)?\.ts$/,
    }),
  ],
  sourcemap: true,
  outputOptions: {
    minifyInternalExports: false,
  },
  exports: {
    devExports: true,
  },
  deps: {
    neverBundle: ["vitest", "pg", "@queuert/testcontainers"],
  },
});
