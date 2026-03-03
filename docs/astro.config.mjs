import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
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
          label: "Advanced",
          collapsed: true,
          autogenerate: { directory: "advanced" },
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
