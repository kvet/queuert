import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { fileRoutes } from "filesystem-routing/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { content, contentDirectory, readPages } from "./plugins/content.ts";
import { dashboardDemoWorker, writeDashboardDemoWorker } from "./plugins/dashboard-demo-worker.ts";
import { pageHref, writeSearchIndex } from "./plugins/search-index.ts";
import { writeSiteFiles } from "./plugins/site-files.ts";
import { finishStaticOutput } from "./plugins/static-output.ts";
import { siteUrl } from "./src/docs/site.ts";

const base = new URL(siteUrl).pathname;

export default defineConfig({
  base,
  plugins: [
    content({ base }),
    dashboardDemoWorker({ base }),
    tailwindcss(),
    solidPlugin({
      start: { renderMode: "async" },
      ssr: true,
      extensions: [".md", ".mdx"],
    }),
    fileRoutes(),
    nitro({
      preset: "static",
      prerender: {
        crawlLinks: true,
        routes: ["/", "/404", "/api/", "/changelog/"],
        failOnError: true,
      },
      hooks: {
        "prerender:routes": async (routes) => {
          for (const page of await readPages()) routes.add(pageHref(page));
        },
        "prerender:done": async () => {
          const publicDirectory = `${import.meta.dirname}/.output/public`;
          await finishStaticOutput(publicDirectory);
          await writeDashboardDemoWorker(publicDirectory);
          await writeSearchIndex(publicDirectory, { base, contentDirectory, readPages });
          await writeSiteFiles(publicDirectory, { base, readPages });
        },
      },
    }),
  ],
});
