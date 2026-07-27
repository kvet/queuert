import starlight from "@astrojs/starlight";
import astroD2 from "astro-d2";
import { defineConfig } from "astro/config";
import starlightChangelogs, { makeChangelogsSidebarLinks } from "starlight-changelogs";
import starlightLlmsTxt from "starlight-llms-txt";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";

const packages = [
  { label: "queuert", dir: "core", slug: "core" },
  {
    label: "queuert/conformance",
    dir: "core",
    slug: "conformance",
    entryPoints: ["../packages/core/src/conformance.ts"],
  },
  { label: "@queuert/postgres", dir: "postgres", slug: "postgres" },
  { label: "@queuert/sqlite", dir: "sqlite", slug: "sqlite" },
  { label: "@queuert/redis", dir: "redis", slug: "redis" },
  { label: "@queuert/nats", dir: "nats", slug: "nats" },
  { label: "@queuert/otel", dir: "otel", slug: "otel" },
  { label: "@queuert/dashboard", dir: "dashboard", slug: "dashboard" },
];

const typeDocPlugins = [];
const typeDocSidebarGroups = [];
for (const pkg of packages) {
  const [plugin, sidebarGroup] = createStarlightTypeDocPlugin();
  typeDocPlugins.push(
    plugin({
      entryPoints: pkg.entryPoints ?? [`../packages/${pkg.dir}/src/index.ts`],
      tsconfig: `../packages/${pkg.dir}/tsconfig.json`,
      output: `api/${pkg.slug}`,
      sidebar: { label: pkg.label, collapsed: true },
      typeDoc: {
        readme: "none",
        excludeInternal: true,
        gitRevision: "main",
        skipErrorChecking: true,
      },
    }),
  );
  typeDocSidebarGroups.push(sidebarGroup);
}

export default defineConfig({
  site: "https://kvet.github.io",
  base: "/queuert",
  integrations: [
    astroD2({
      sketch: true,
      layout: "elk",
      pad: 20,
      theme: { dark: false },
    }),
    starlight({
      plugins: [starlightLlmsTxt(), starlightChangelogs(), ...typeDocPlugins],
      title: "Queuert",
      description: "Durable, typed job chains that commit with your database transactions",
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
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "Integrations",
          items: [{ autogenerate: { directory: "integrations" } }],
        },
        {
          label: "Examples",
          slug: "examples",
        },
        {
          label: "Comparison",
          items: [{ autogenerate: { directory: "comparison" } }],
        },
        {
          label: "Benchmarks",
          slug: "benchmarks",
        },
        {
          label: "Reference",
          items: typeDocSidebarGroups,
        },
        {
          label: "Advanced",
          collapsed: true,
          items: [{ autogenerate: { directory: "advanced" } }],
        },
        ...makeChangelogsSidebarLinks([{ type: "all", base: "changelog", label: "Changelog" }]),
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
