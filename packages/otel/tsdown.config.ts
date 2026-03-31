import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/testing.ts"],
  dts: true,
  sourcemap: true,
  outputOptions: {
    minifyInternalExports: false,
  },
  exports: {
    devExports: true,
  },
  deps: {
    neverBundle: [
      "@opentelemetry/api",
      "@opentelemetry/sdk-metrics",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/core",
      "@opentelemetry/semantic-conventions",
      "@opentelemetry/resources",
      "vitest",
    ],
  },
});
