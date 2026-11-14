import { syncAsyncCompiler } from "@queuert/sync-async/plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    syncAsyncCompiler({
      exclude: /[\\/]conformance[^\\/]*[\\/]|conformance[^\\/]*$|\.spec(-helper)?\.ts$/,
    }),
  ],
});
