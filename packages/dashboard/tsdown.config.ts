import { syncAsyncCompiler } from "@queuert/sync-async/plugin";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  dts: true,
  plugins: [syncAsyncCompiler({ exclude: /\.spec(-helper)?\.ts$/ })],
  sourcemap: true,
  outputOptions: {
    minifyInternalExports: false,
  },
  exports: {
    devExports: true,
  },
  deps: {
    onlyBundle: false,
    neverBundle: ["vitest"],
  },
});
