import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { type Plugin, build } from "vite";

const dashboardDemoWorkerEntry = resolve(
  import.meta.dirname,
  "../src/components/integrations/dashboard/demo/service-worker.ts",
);

export const dashboardDemoWorkerFile = "dashboard-demo.js";

export const bundleDashboardDemoWorker = async (
  entry: string,
  options: { minify: boolean },
): Promise<string> => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: options.minify,
      rolldownOptions: {
        input: entry,
        output: { format: "iife", codeSplitting: false },
      },
    },
  });
  const [output] = Array.isArray(result) ? result : [result];
  if (!("output" in output)) throw new Error("Expected an in-memory bundle");
  return output.output[0].code;
};

export const writeDashboardDemoWorker = async (
  publicDirectory: string,
  entry: string = dashboardDemoWorkerEntry,
): Promise<void> => {
  await writeFile(
    join(publicDirectory, dashboardDemoWorkerFile),
    await bundleDashboardDemoWorker(entry, { minify: true }),
  );
};

export const dashboardDemoWorker = ({ base }: { base: string }): Plugin => ({
  name: "queuert-dashboard-demo-worker",
  apply: "serve",
  configureServer: (server) => {
    const path = `${base}${dashboardDemoWorkerFile}`;
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?")[0] !== path) {
        next();
        return;
      }
      bundleDashboardDemoWorker(dashboardDemoWorkerEntry, { minify: false }).then(
        (code) => {
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(code);
        },
        (error: unknown) => {
          next(error);
        },
      );
    });
  },
});
