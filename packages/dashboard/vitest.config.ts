import { syncAsyncCompiler } from "@queuert/sync-async/plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [syncAsyncCompiler({ exclude: /\.spec(-helper)?\.ts$/ })],
});
