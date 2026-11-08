import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { content, contentDirectory, readPages } from "./plugins/content.ts";
import { dashboardDemoWorker, writeDashboardDemoWorker } from "./plugins/dashboard-demo-worker.ts";
import { writeSearchIndex } from "./plugins/search-index.ts";
import { flattenStaticOutput } from "./plugins/static-output.ts";

const base = "/queuert/";

export default defineConfig({
  base,
  plugins: [
    content({ base }),
    dashboardDemoWorker({ base }),
    tailwindcss(),
    solidStart({ extensions: ["md", "mdx"] }),
    nitro({
      preset: "static",
      prerender: {
        crawlLinks: true,
        routes: [base, `${base}404`, `${base}api/`, `${base}changelog/`],
        failOnError: true,
      },
      hooks: {
        "prerender:done": async () => {
          const publicDirectory = `${import.meta.dirname}/.output/public`;
          await flattenStaticOutput(publicDirectory, base);
          await writeDashboardDemoWorker(publicDirectory);
          await writeSearchIndex(publicDirectory, { base, contentDirectory, readPages });
        },
      },
    }),
  ],
});
