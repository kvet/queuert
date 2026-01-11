import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  dts: true,
  sourcemap: true,
  exports: {
    devExports: true,
  },
  external: ["@opentelemetry/api"],
});
