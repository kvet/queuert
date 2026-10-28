import { type Element, type Root as HastRoot } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import { type Root as MdastRoot } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { type Plugin } from "vite";

import { highlight } from "./highlight.ts";

export type Release = {
  tag: string;
  name: string;
  date: string;
  url: string;
  html: string;
  breaking: boolean;
  sections: string[];
};

export type Changelog = { releases: Release[]; unavailable: boolean };

type GitHubRelease = {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
};

const repository = "kvet/queuert";

const remarkReleaseHeadings = () => (tree: MdastRoot) => {
  tree.children = tree.children.filter(
    (node) =>
      !(node.type === "heading" && node.depth <= 2 && /what'?s changed/i.test(mdastToString(node))),
  );
  visit(tree, "heading", (node) => {
    node.depth = Math.max(3, node.depth) as typeof node.depth;
  });
};

const rehypeHighlightCode = () => async (tree: HastRoot) => {
  const blocks: { pre: Element; code: Element }[] = [];
  visit(tree, "element", (node) => {
    const [code] = node.children;
    if (node.tagName === "pre" && code?.type === "element" && code.tagName === "code") {
      blocks.push({ pre: node, code });
    }
  });
  await Promise.all(
    blocks.map(async ({ pre, code }) => {
      const className = code.properties.className;
      const lang = Array.isArray(className)
        ? (className.find((name) => name.startsWith("language-")) ?? "").slice(9)
        : "";
      const html = await highlight(hastToString(code).replace(/\n$/, ""), lang || "text");
      pre.tagName = "div";
      pre.properties = { className: ["release-code"] };
      pre.children = [{ type: "raw", value: html } as unknown as Element];
    }),
  );
};

export const releaseToHtml = async (
  body: string,
): Promise<{ html: string; sections: string[] }> => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkReleaseHeadings)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeHighlightCode)
    .use(rehypeStringify, { allowDangerousHtml: true });
  const tree = await processor.run(processor.parse(body.replaceAll("\r\n", "\n")));
  const sections: string[] = [];
  visit(tree, "element", (node) => {
    if (node.tagName === "h3") sections.push(hastToString(node));
  });
  return { html: processor.stringify(tree), sections };
};

const fetchReleases = async (): Promise<GitHubRelease[]> => {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const releases: GitHubRelease[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error(`GitHub releases request failed: ${response.status}`);
    const batch = (await response.json()) as GitHubRelease[];
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return releases;
};

export const loadChangelog = async (): Promise<Changelog> => {
  let releases: GitHubRelease[];
  try {
    releases = await fetchReleases();
  } catch (error) {
    if (process.env.CI) throw error;
    console.warn(`[changelog] ${String(error)}; rendering an empty changelog`);
    return { releases: [], unavailable: true };
  }
  return {
    unavailable: false,
    releases: await Promise.all(
      releases
        .filter((release) => !release.draft && !release.prerelease && release.published_at !== null)
        .map(async (release): Promise<Release> => {
          const { html, sections } = await releaseToHtml(release.body ?? "");
          return {
            tag: release.tag_name,
            name: release.name === null || release.name === "" ? release.tag_name : release.name,
            date: release.published_at!,
            url: release.html_url,
            html,
            breaking: sections.some((section) => /breaking/i.test(section)),
            sections,
          };
        }),
    ),
  };
};

const changelogId = "virtual:changelog";
const resolvedChangelogId = `\0${changelogId}`;

export const changelog = (): Plugin => {
  let cached: Promise<Changelog> | undefined;
  return {
    name: "queuert:changelog",
    resolveId: (id) => (id === changelogId ? resolvedChangelogId : undefined),
    load: async (id) => {
      if (id !== resolvedChangelogId) return;
      cached ??= loadChangelog();
      return `export default ${JSON.stringify(await cached)};`;
    },
  };
};
