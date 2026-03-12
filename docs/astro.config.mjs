import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

export default defineConfig({
  site: "https://kvet.github.io",
  base: "/queuert",
  integrations: [
    starlight({
      plugins: [starlightLlmsTxt()],
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
          label: "Examples",
          slug: "examples",
        },
        {
          label: "Benchmarks",
          slug: "benchmarks",
        },
        {
          label: "Reference",
          items: [
            {
              label: "queuert",
              items: [
                { label: "Client", slug: "reference/queuert/client" },
                { label: "Worker", slug: "reference/queuert/worker" },
                { label: "Utilities", slug: "reference/queuert/utilities" },
                { label: "Types", slug: "reference/queuert/types" },
                { label: "Transaction Hooks", slug: "reference/queuert/transaction-hooks" },
                { label: "Errors", slug: "reference/queuert/errors" },
              ],
            },
            {
              label: "@queuert/postgres",
              slug: "reference/postgres",
            },
            {
              label: "@queuert/sqlite",
              slug: "reference/sqlite",
            },
            {
              label: "@queuert/redis",
              slug: "reference/redis",
            },
            {
              label: "@queuert/nats",
              slug: "reference/nats",
            },
            {
              label: "@queuert/otel",
              slug: "reference/otel",
            },
            {
              label: "@queuert/dashboard",
              slug: "reference/dashboard",
            },
          ],
        },
        {
          label: "Advanced",
          collapsed: true,
          autogenerate: { directory: "advanced" },
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
