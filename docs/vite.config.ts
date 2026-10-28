import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { content, contentDirectory, readPages } from "./plugins/content.ts";
import { writeSearchIndex } from "./plugins/search-index.ts";
import { flattenStaticOutput } from "./plugins/static-output.ts";

const base = "/queuert/";

export default defineConfig({
  base,
  plugins: [
    content({ base }),
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
          await writeSearchIndex(publicDirectory, { base, contentDirectory, readPages });
        },
      },
    }),
  ],
});
