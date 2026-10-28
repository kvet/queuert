import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type Element, type Root, type RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { type Plugin } from "vite";

import { apiPackages, siteSections } from "../src/docs/sections.ts";
import { type SourcePage } from "./content.ts";

export type SearchEntry = {
  id: number;
  title: string;
  heading: string;
  section: string;
  href: string;
  text: string;
};

type SearchOptions = {
  base: string;
  contentDirectory: string;
  readPages: () => Promise<SourcePage[]>;
};

const maxSectionText = 700;

const inlineTags = new Set([
  "a",
  "abbr",
  "b",
  "code",
  "del",
  "em",
  "i",
  "kbd",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
]);

const skippedTags = new Set(["button", "script", "style", "svg", "template"]);

const pageHref = (page: SourcePage) => (page.slug === "" ? "/" : `/${page.slug}/`);

const sectionLabel = (page: SourcePage): string => {
  if (page.api) {
    const pkg = apiPackages.find((candidate) => candidate.slug === page.api!.package);
    return `API · ${pkg?.label ?? page.api.package}`;
  }
  for (const section of siteSections) {
    const group = section.groups.find((candidate) => candidate.slugs.includes(page.slug));
    if (group)
      return group.label === section.label ? section.label : `${section.label} · ${group.label}`;
  }
  return "Docs";
};

const findContent = (node: Root | Element): Element | undefined => {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.properties.dataPageContent !== undefined) return child;
    const found = findContent(child);
    if (found) return found;
  }
  return undefined;
};

const isSkipped = (element: Element) =>
  skippedTags.has(element.tagName) ||
  element.properties.dataBoxHeader !== undefined ||
  element.properties.dataCodeLang !== undefined ||
  element.properties.dataSourceLink !== undefined ||
  element.properties.role === "tablist" ||
  (Array.isArray(element.properties.className) &&
    element.properties.className.includes("heading-anchor"));

const plainText = (node: RootContent): string => {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || isSkipped(node)) return "";
  return node.children.map(plainText).join("");
};

type PageSection = { heading: string; id: string; text: string };

type PageRow = { name: string; id: string; text: string };

type PageIndex = { sections: PageSection[]; rows: PageRow[] };

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const findSelfLink = (node: Element, id: string): Element | undefined => {
  for (const child of node.children) {
    if (child.type !== "element" || isSkipped(child)) continue;
    if (child.tagName === "a" && child.properties.href === `#${id}`) return child;
    const found = findSelfLink(child, id);
    if (found) return found;
  }
  return undefined;
};

const rowName = (node: Element): string | undefined => {
  const id = node.properties.id;
  if (node.tagName !== "li" || typeof id !== "string") return undefined;
  const link = findSelfLink(node, id);
  return link && normalize(plainText(link));
};

export const pageIndex = (html: string): PageIndex => {
  const content = findContent(fromHtml(html));
  if (!content) throw new Error("Rendered page has no [data-page-content] element");
  const sections: PageSection[] = [{ heading: "", id: "", text: "" }];
  const rows: PageRow[] = [];
  const walk = (node: RootContent, append: (text: string) => void) => {
    if (node.type === "text") {
      append(node.value);
      return;
    }
    if (node.type !== "element" || isSkipped(node)) return;
    const id = node.properties.id;
    if (/^h[2-4]$/.test(node.tagName) && typeof id === "string") {
      sections.push({ heading: normalize(plainText(node)), id, text: "" });
      return;
    }
    const label = node.properties.ariaLabel;
    if (node.tagName === "figure" && typeof label === "string") {
      append(` Diagram: ${label} `);
      return;
    }
    const name = rowName(node);
    if (name && typeof id === "string") {
      const row: PageRow = { name, id, text: "" };
      rows.push(row);
      append(` ${name} `);
      for (const child of node.children) walk(child, (text) => (row.text += text));
      row.text = normalize(row.text);
      return;
    }
    const block = !inlineTags.has(node.tagName);
    if (block) append(" ");
    for (const child of node.children) walk(child, append);
    if (block) append(" ");
  };
  for (const child of content.children) walk(child, (text) => (sections.at(-1)!.text += text));
  return {
    sections: sections.map((section) => ({ ...section, text: normalize(section.text) })),
    rows,
  };
};

export const pageSections = (html: string): PageSection[] => pageIndex(html).sections;

const truncate = (text: string) => {
  if (text.length <= maxSectionText) return text;
  const cut = text.slice(0, maxSectionText);
  const space = cut.lastIndexOf(" ");
  return `${space === -1 ? cut : cut.slice(0, space)} …`;
};

export const pageSearchEntries = (page: SourcePage, html: string): Omit<SearchEntry, "id">[] => {
  const href = pageHref(page);
  const section = sectionLabel(page);
  const { sections, rows } = pageIndex(html);
  const sectionEntries = sections.flatMap((pageSection) => {
    const text =
      pageSection.heading === "" && page.api === null
        ? `${page.description ?? ""} ${pageSection.text}`.trim()
        : pageSection.text;
    if (pageSection.heading === "" && text === "") return [];
    return [
      {
        title: page.title,
        heading: pageSection.heading,
        section,
        href: pageSection.id ? `${href}#${pageSection.id}` : href,
        text: truncate(text),
      },
    ];
  });
  const rowEntries = rows.map((row) => ({
    title: page.title,
    heading: row.name,
    section,
    href: `${href}#${row.id}`,
    text: truncate(
      row.text.startsWith(row.name) ? row.text.slice(row.name.length).trim() : row.text,
    ),
  }));
  return [...sectionEntries, ...rowEntries];
};

const mapLimited = async <T, R>(
  items: T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

const buildSearchIndex = async (
  pages: SourcePage[],
  readHtml: (page: SourcePage) => Promise<string>,
): Promise<SearchEntry[]> => {
  const entries = await mapLimited(pages, 8, async (page) =>
    pageSearchEntries(page, await readHtml(page)),
  );
  return entries.flat().map((entry, id) => ({ id, ...entry }));
};

export const writeSearchIndex = async (
  publicDirectory: string,
  options: SearchOptions,
): Promise<void> => {
  const pages = await options.readPages();
  const search = await buildSearchIndex(pages, async (page) =>
    readFile(join(publicDirectory, page.slug, "index.html"), "utf8"),
  );
  await writeFile(join(publicDirectory, "search.json"), JSON.stringify(search));
};

export const searchIndex = (options: SearchOptions): Plugin => {
  let cache: Promise<string> | undefined;
  return {
    name: "queuert:search-index",
    configureServer(server) {
      server.watcher.on("all", (_event, file) => {
        if (file.startsWith(options.contentDirectory)) cache = undefined;
      });
      const build = async (origin: string) => {
        const pages = await options.readPages();
        const search = await buildSearchIndex(pages, async (page) => {
          const pageResponse = await fetch(
            `${origin}${options.base}${page.slug === "" ? "" : `${page.slug}/`}`,
          );
          if (!pageResponse.ok) throw new Error(`${page.slug}: HTTP ${pageResponse.status}`);
          return pageResponse.text();
        });
        return JSON.stringify(search);
      };
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== `${options.base}search.json`) {
          next();
          return;
        }
        cache ??= build(`http://${request.headers.host}`);
        cache.then(
          (body) => {
            response.setHeader("Content-Type", "application/json");
            response.end(body);
          },
          (error: unknown) => {
            cache = undefined;
            next(error);
          },
        );
      });
    },
  };
};
