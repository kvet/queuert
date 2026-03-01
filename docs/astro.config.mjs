import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightTypeDoc from "starlight-typedoc";

export default defineConfig({
  site: "https://kvet.github.io",
  base: "/queuert",
  integrations: [
    starlight({
      plugins: [
        starlightLlmsTxt({
          demote: ["api/**"],
          small: {
            exclude: ["api/**"],
          },
        }),
        starlightTypeDoc({
          entryPoints: [
            "../packages/core",
            "../packages/postgres",
            "../packages/sqlite",
            "../packages/redis",
            "../packages/nats",
            "../packages/otel",
            "../packages/dashboard",
          ],
          tsconfig: "../packages/core/tsconfig.json",
          output: "api",
          typeDoc: {
            entryPointStrategy: "packages",
            packageOptions: {
              entryPoints: ["src/index.ts"],
            },
          },
        }),
      ],
      title: "Queuert",
      description: "Control flow library for your persistence-layer-driven applications",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/kvet/queuert",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/kvet/queuert/edit/main/docs/",
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            {
              label: "Introduction",
              slug: "getting-started/introduction",
            },
            {
              label: "Installation",
              slug: "getting-started/installation",
            },
            {
              label: "Core Concepts",
              slug: "getting-started/core-concepts",
            },
          ],
        },
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Integrations",
          autogenerate: { directory: "integrations" },
        },
        {
          label: "Reference",
          collapsed: true,
          autogenerate: { directory: "reference" },
        },
        {
          label: "API",
          collapsed: true,
          items: [
            { label: "queuert", autogenerate: { directory: "api/queuert" } },
            {
              label: "@queuert/postgres",
              autogenerate: { directory: "api/@queuert/postgres" },
            },
            {
              label: "@queuert/sqlite",
              autogenerate: { directory: "api/@queuert/sqlite" },
            },
            {
              label: "@queuert/redis",
              autogenerate: { directory: "api/@queuert/redis" },
            },
            {
              label: "@queuert/nats",
              autogenerate: { directory: "api/@queuert/nats" },
            },
            {
              label: "@queuert/otel",
              autogenerate: { directory: "api/@queuert/otel" },
            },
            {
              label: "@queuert/dashboard",
              autogenerate: { directory: "api/@queuert/dashboard" },
            },
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
