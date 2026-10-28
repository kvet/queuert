import { describe, expect, it } from "vitest";

import { pagesFromSources } from "./content.ts";

const definedIn =
  "Defined in: [packages/core/src/client.ts:614](https://github.com/kvet/queuert/blob/main/packages/core/src/client.ts#L614)";

const apiPage = (heading: string, ...blocks: string[]) =>
  [`# ${heading}`, "```ts\nconst signature = 1;\n```", definedIn, ...blocks].join("\n\n");

const pageFor = (sources: { file: string; source: string }[], slug: string) =>
  pagesFromSources(sources).find((page) => page.slug === slug);

describe("pagesFromSources", () => {
  it("strips the kind prefix, generics and call parentheses from API page titles", () => {
    const pages = pagesFromSources([
      { file: "api/core/functions/createClient.md", source: apiPage("Function: createClient()") },
      {
        file: "api/core/type-aliases/Client.md",
        source: apiPage("Type Alias: Client\\<TJobTypeDefinitions, TStateAdapter\\>"),
      },
      {
        file: "api/core/classes/JobNotFoundError.md",
        source: apiPage("Class: JobNotFoundError"),
      },
      {
        file: "api/core/variables/jobTypeRegistry.md",
        source: apiPage("Variable: jobTypeRegistry"),
      },
    ]);

    expect(pages.map((page) => [page.slug, page.title, page.api?.kind])).toEqual([
      ["api/core/classes/jobnotfounderror", "JobNotFoundError", "Class"],
      ["api/core/functions/createclient", "createClient", "Function"],
      ["api/core/type-aliases/client", "Client", "Type"],
      ["api/core/variables/jobtyperegistry", "jobTypeRegistry", "Variable"],
    ]);
  });

  it("summarises an API page with its first prose block, without links or markup", () => {
    const page = pageFor(
      [
        {
          file: "api/core/functions/createClient.md",
          source: apiPage(
            "Function: createClient()",
            "> **createClient**(options)",
            "- a list item",
            "| Parameter | Type |\n| :-- | :-- |",
            "`inline code first`",
            "**`Experimental`**",
            "***",
            "Create a new *Queuert* client from\n[defineJobTypes](defineJobTypes.md) slices and `options`.",
            "A later paragraph.",
          ),
        },
      ],
      "api/core/functions/createclient",
    );

    expect(page?.description).toBe(
      "Create a new Queuert client from defineJobTypes slices and options.",
    );
    expect(page?.api?.experimental).toBe(true);
  });

  it("leaves package index pages without a kind or summary and reads frontmatter on guides", () => {
    const pages = pagesFromSources([
      { file: "api/core/README.md", source: "# queuert\n\nClient and worker." },
      {
        file: "guides/scheduling.md",
        source:
          "---\ntitle: Scheduling\ndescription: Start a chain later.\nlayout: wide\n---\n\n# Scheduling\n\nBody.",
      },
    ]);

    expect(pages).toEqual([
      {
        slug: "api/core/readme",
        file: "api/core/README.md",
        title: "queuert",
        description: null,
        layout: "default",
        api: { package: "core", kind: null, experimental: false, usedIn: [] },
      },
      {
        slug: "guides/scheduling",
        file: "guides/scheduling.md",
        title: "Scheduling",
        description: "Start a chain later.",
        layout: "wide",
        api: null,
      },
    ]);
  });

  it("lists the guides that mention a symbol in code, in markdown and in TSX pages", () => {
    const usedIn = pageFor(
      [
        { file: "api/core/functions/createClient.md", source: apiPage("Function: createClient()") },
        { file: "api/core/README.md", source: "Start with `createClient(`." },
        { file: "guides/inline.md", source: "Call `createClient` once per process." },
        { file: "guides/fenced.md", source: "```ts\nconst client = await createClient({});\n```" },
        { file: "guides/call.md", source: "Call `createClient({ stateAdapter })`." },
        { file: "guides/mdx.mdx", source: "<p>Use <code>createClient</code> here.</p>" },
        {
          file: "comparison/page.tsx",
          source:
            'export const meta = { title: "Page" };\n\nconst Page = () => <code>{"createClient"}</code>;\n\nexport default Page;\n',
        },
        { file: "guides/prose.md", source: "The createClient factory in prose." },
        { file: "guides/longer.md", source: "See `createClientOptions`." },
      ],
      "api/core/functions/createclient",
    )?.api?.usedIn;

    expect(usedIn).toEqual(["comparison/page", "guides/call", "guides/inline", "guides/mdx"]);
  });

  it("skips guide matching for symbols of three characters or fewer", () => {
    const page = pageFor(
      [
        { file: "api/core/type-aliases/Log.md", source: apiPage("Type Alias: Log") },
        { file: "guides/logging.md", source: "Pass a `Log` function." },
      ],
      "api/core/type-aliases/log",
    );

    expect(page?.api?.usedIn).toEqual([]);
  });
});
