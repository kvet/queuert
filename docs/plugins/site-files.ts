import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Element, RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toString as hastToString } from "hast-util-to-string";

import { apiPackages, siteSections } from "../src/docs/sections.ts";
import { absoluteUrl, siteDescription, siteName, siteUrl } from "../src/docs/site.ts";
import type { SourcePage } from "./content.ts";
import { findContent, inlineTags, isSkipped, pageHref } from "./search-index.ts";

const routePaths = ["/", "/api/", "/changelog/"];

const findElement = (node: Element, tagName: string): Element | undefined => {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === tagName) return child;
    const found = findElement(child, tagName);
    if (found) return found;
  }
  return undefined;
};

const resolveHref = (href: string, base: string, pageUrl: string): string => {
  if (href.startsWith("#")) return `${pageUrl}${href}`;
  if (href.startsWith(base)) return absoluteUrl(href.slice(base.length));
  return href;
};

const fence = (code: string, lang: string, title: string) =>
  `\`\`\`${lang}${title === "" ? "" : ` title="${title}"`}\n${code.replace(/\n$/, "")}\n\`\`\``;

export const pageMarkdown = (html: string, options: { base: string; pageUrl: string }): string => {
  const content = findContent(fromHtml(html));
  if (!content) throw new Error("Rendered page has no [data-page-content] element");
  const codeBlocks: string[] = [];
  const block = (text: string) => `\n\n${text}\n\n`;
  const render = (node: RootContent): string => {
    if (node.type === "text") return node.value.replace(/\s+/g, " ");
    if (node.type !== "element") return "";
    const lang = node.properties.dataCodeLang;
    if (lang !== undefined) {
      const header = findElement(node, "header");
      const title = header ? findElement(header, "h2") : undefined;
      const pre = findElement(node, "pre");
      codeBlocks.push(
        fence(pre ? hastToString(pre) : "", String(lang), title ? hastToString(title).trim() : ""),
      );
      return block(`\0${codeBlocks.length - 1}\0`);
    }
    if (isSkipped(node)) return "";
    const elementsOnly =
      inlineTags.has(node.tagName) &&
      node.children.every(
        (child) => child.type === "element" || (child.type === "text" && child.value.trim() === ""),
      );
    const children = () => node.children.map(render).join(elementsOnly ? " " : "");
    const heading = /^h([2-6])$/.exec(node.tagName);
    if (heading) return block(`${"#".repeat(Number(heading[1]))} ${children().trim()}`);
    const label = node.properties.ariaLabel;
    if (node.tagName === "figure" && typeof label === "string") return block(`Diagram: ${label}`);
    const tab = node.properties.dataTabLabel;
    if (node.properties.role === "tabpanel" && typeof tab === "string") {
      return block(`**${tab}**`) + children();
    }
    if (node.tagName === "li") {
      const item = children().trim();
      return item.includes("\0") ? block(`- ${item}`) : `\n- ${item.replace(/\n+/g, " ")}`;
    }
    if (node.tagName === "pre") {
      codeBlocks.push(fence(hastToString(node), "", ""));
      return block(`\0${codeBlocks.length - 1}\0`);
    }
    if (node.tagName === "code") return `\`${hastToString(node)}\``;
    const href = node.properties.href;
    if (node.tagName === "a" && typeof href === "string") {
      const text = children().trim();
      return text === "" ? "" : `[${text}](${resolveHref(href, options.base, options.pageUrl)})`;
    }
    return inlineTags.has(node.tagName) ? children() : block(children());
  };
  return content.children
    .map(render)
    .join("")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\0(\d+)\0/g, (_match, index: string) => `\n${codeBlocks[Number(index)]}\n`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const sitemapXml = (paths: string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((path) => `  <url><loc>${escapeXml(absoluteUrl(path))}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");

const guidePages = (pages: SourcePage[]) => {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  return siteSections.flatMap((section) =>
    section.groups.map((group) => ({
      label: group.label === section.label ? section.label : `${section.label}: ${group.label}`,
      pages: group.slugs.flatMap((slug) => bySlug.get(slug) ?? []),
    })),
  );
};

const linkLine = (title: string, path: string, description: string | null) =>
  `- [${title}](${absoluteUrl(path)})${description ? `: ${description}` : ""}`;

export const llmsTxt = (pages: SourcePage[]): string =>
  [
    `# ${siteName}`,
    `> ${siteDescription}`,
    `The whole documentation (Docs, Integrations, Examples, Compare, Benchmarks and Blog) as one file: ${siteUrl}llms-full.txt`,
    ...guidePages(pages).map((group) =>
      [
        `## ${group.label}`,
        ...group.pages.map((page) => linkLine(page.title, pageHref(page), page.description)),
      ].join("\n"),
    ),
    [
      "## API Reference",
      ...apiPackages.map((pkg) => linkLine(pkg.label, `/api/${pkg.slug}/readme/`, pkg.summary)),
    ].join("\n"),
    ["## Optional", linkLine("Changelog", "/changelog/", "Release notes for every version.")].join(
      "\n",
    ),
    "",
  ].join("\n\n");

export const llmsFullTxt = (
  pages: { page: SourcePage; html: string }[],
  options: { base: string },
): string =>
  `${pages
    .map(({ page, html }) => {
      const pageUrl = absoluteUrl(pageHref(page));
      return [
        `# ${page.title}`,
        `Source: ${pageUrl}`,
        ...(page.description ? [`> ${page.description}`] : []),
        pageMarkdown(html, { base: options.base, pageUrl }),
      ].join("\n\n");
    })
    .join("\n\n---\n\n")}\n`;

export const writeSiteFiles = async (
  publicDirectory: string,
  options: { base: string; readPages: () => Promise<SourcePage[]> },
): Promise<void> => {
  const pages = await options.readPages();
  const guides = await Promise.all(
    guidePages(pages)
      .flatMap((group) => group.pages)
      .map(async (page) => ({
        page,
        html: await readFile(join(publicDirectory, page.slug, "index.html"), "utf8"),
      })),
  );
  await writeFile(
    join(publicDirectory, "sitemap.xml"),
    sitemapXml([...routePaths, ...pages.map(pageHref)]),
  );
  await writeFile(join(publicDirectory, "llms.txt"), llmsTxt(pages));
  await writeFile(join(publicDirectory, "llms-full.txt"), llmsFullTxt(guides, options));
};
