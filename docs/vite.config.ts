import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { content, contentDirectory, readPages } from "./plugins/content.ts";
import { dashboardDemoWorker, writeDashboardDemoWorker } from "./plugins/dashboard-demo-worker.ts";
import { writeSearchIndex } from "./plugins/search-index.ts";
import { writeSiteFiles } from "./plugins/site-files.ts";
import { flattenStaticOutput } from "./plugins/static-output.ts";
import { siteUrl } from "./src/docs/site.ts";

const base = new URL(siteUrl).pathname;

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
          await writeSiteFiles(publicDirectory, { base, readPages });
        },
      },
    }),
  ],
});
