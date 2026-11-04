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
      "vitest",
      "@nats-io/nats-core",
      "@nats-io/transport-node",
      "@queuert/testcontainers",
    ],
  },
});
