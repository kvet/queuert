import { glob, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import mdx from "@mdx-js/rollup";
import { type Plugin, type ViteDevServer } from "vite";
import { parse as parseYaml } from "yaml";

import { changelog } from "./changelog.ts";
import { highlight } from "./highlight.ts";
import { mdxOptions, pageSlug } from "./mdx.ts";
import { searchIndex } from "./search-index.ts";
import { readPageMeta, tsxPages } from "./tsx-pages.ts";
import { typedoc } from "./typedoc.ts";

export const contentDirectory = fileURLToPath(new URL("../src/content/docs", import.meta.url));

const starlightShim = fileURLToPath(new URL("../src/components/mdx/starlight.ts", import.meta.url));
const diagramModule = fileURLToPath(
  new URL("../src/components/diagrams/flow/Diagram.tsx", import.meta.url),
);

const pagesId = "virtual:docs-pages";
const resolvedPagesId = `\0${pagesId}`;
const highlightSuffix = "?highlight";
const highlightPrefix = "\0highlight:";

const apiKinds: Record<string, string> = {
  classes: "Class",
  functions: "Function",
  interfaces: "Interface",
  "type-aliases": "Type",
  variables: "Variable",
  enumerations: "Enum",
};

export type SourcePage = {
  slug: string;
  file: string;
  title: string;
  description: string | null;
  layout: "default" | "wide";
  api: { package: string; kind: string | null; experimental: boolean; usedIn: string[] } | null;
};

const apiSummary = (source: string): string | null => {
  const blocks = source.split(/\n{2,}/).map((block) => block.trim());
  const summary = blocks.find(
    (block) =>
      block !== "" &&
      !/^(#|>|Defined in:|\*\*`|\*\*\*|```|-|\|)/.test(block) &&
      !block.startsWith("`"),
  );
  return summary
    ? summary
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[`*_\\]/g, "")
        .replace(/\s+/g, " ")
    : null;
};

const symbolMentions = (name: string) =>
  new RegExp(`(?:<code>(?:\\{["'\`])?|\`)${name.replace(/[$]/g, "\\$&")}[<(.&"'\`]`);

export const pagesFromSources = (sources: { file: string; source: string }[]): SourcePage[] => {
  const guides = sources.filter(({ file }) => !file.startsWith("api/"));
  const pages = sources.map(({ file, source }): SourcePage => {
    if (file.endsWith(".tsx")) {
      return { slug: pageSlug(file), file, ...readPageMeta(source, file), api: null };
    }
    const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "") ?? {};
    const slug = pageSlug(file);
    const heading = /^# (.+)$/m
      .exec(source)?.[1]
      ?.replaceAll("\\", "")
      .replace(/^(Type Alias|Function|Class|Interface|Variable|Enumeration): /, "")
      .replace(/<.*$/, "")
      .replace(/\(\)$/, "");
    const apiMatch = /^api\/([^/]+)\/(?:([^/]+)\/)?/.exec(file);
    const title = String(frontmatter.title ?? heading ?? slug);
    return {
      slug,
      file,
      title,
      description:
        frontmatter.description === undefined
          ? apiMatch?.[2]
            ? apiSummary(source)
            : null
          : String(frontmatter.description),
      layout: frontmatter.layout === "wide" ? "wide" : "default",
      api: apiMatch
        ? {
            package: apiMatch[1] ?? "",
            kind: apiMatch[2] === undefined ? null : (apiKinds[apiMatch[2]] ?? apiMatch[2]),
            experimental: source.includes("**`Experimental`**"),
            usedIn:
              title.length > 3
                ? guides
                    .filter((guide) => symbolMentions(title).test(guide.source))
                    .map((guide) => pageSlug(guide.file))
                    .sort()
                : [],
          }
        : null,
    };
  });
  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
};

export const readPages = async (): Promise<SourcePage[]> => {
  const sources: { file: string; source: string }[] = [];
  for await (const file of glob("**/*.{md,mdx,tsx}", { cwd: contentDirectory })) {
    sources.push({ file, source: await readFile(join(contentDirectory, file), "utf8") });
  }
  return pagesFromSources(sources);
};

const invalidateOnContentChange = (server: ViteDevServer, ids: string[]) => {
  server.watcher.on("all", (event, file) => {
    if (!file.startsWith(contentDirectory)) return;
    for (const environment of Object.values(server.environments)) {
      for (const id of ids) {
        const module = environment.moduleGraph.getModuleById(id);
        if (module) environment.moduleGraph.invalidateModule(module);
      }
    }
    if (event === "add" || event === "unlink") server.ws.send({ type: "full-reload" });
  });
};

export const content = (options: { base: string }): Plugin[] => [
  typedoc(),
  tsxPages({ contentDirectory }),
  {
    enforce: "pre",
    ...mdx({
      ...mdxOptions({ contentDirectory, base: options.base }),
      include: `${contentDirectory}/**/*.{md,mdx}`,
    }),
  },
  {
    name: "queuert:content-aliases",
    enforce: "pre",
    resolveId: (id, importer) => {
      if (!importer?.startsWith(contentDirectory)) return;
      if (id === "@astrojs/starlight/components") return starlightShim;
      if (/^(\.\.\/)+components\/diagram$/.test(id)) return diagramModule;
    },
  },
  {
    name: "queuert:docs-pages",
    resolveId: (id) => (id === pagesId ? resolvedPagesId : undefined),
    load: async (id) =>
      id === resolvedPagesId ? `export default ${JSON.stringify(await readPages())};` : undefined,
    configureServer: (server) => {
      invalidateOnContentChange(server, [resolvedPagesId]);
    },
  },
  {
    name: "queuert:highlight",
    enforce: "pre",
    async resolveId(id, importer) {
      if (!id.endsWith(highlightSuffix)) return;
      const resolved = await this.resolve(id.slice(0, -highlightSuffix.length), importer);
      return resolved ? `${highlightPrefix}${resolved.id}` : undefined;
    },
    async load(id) {
      if (!id.startsWith(highlightPrefix)) return;
      const file = id.slice(highlightPrefix.length);
      this.addWatchFile(file);
      const code = (await readFile(file, "utf8")).trimEnd();
      const lang = extname(file).slice(1);
      return `export default ${JSON.stringify({ code, lang, html: await highlight(code, lang) })};`;
    },
  },
  changelog(),
  searchIndex({ base: options.base, contentDirectory, readPages }),
];
