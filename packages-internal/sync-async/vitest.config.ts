import { defineConfig } from "vitest/config";

import { syncAsyncCompiler } from "./src/plugin.ts";

export default defineConfig({
  plugins: [syncAsyncCompiler({ exclude: /\.spec\.ts$/ })],
});
