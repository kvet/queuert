import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { pageSlug } from "../../plugins/mdx.ts";
import { sectionForPath, siteSections } from "./sections.ts";

const contentDirectory = fileURLToPath(new URL("../content/docs", import.meta.url));

const contentFiles = async () => {
  const files: string[] = [];
  for await (const file of glob("**/*.{md,mdx,tsx}", { cwd: contentDirectory })) {
    if (!file.startsWith("api/")) files.push(file);
  }
  return files.sort();
};

const handWrittenSlugs = async () => (await contentFiles()).map(pageSlug).sort();

const listedSlugs = () =>
  siteSections.flatMap((section) => section.groups.flatMap((group) => group.slugs));

const docsGroup = (label: string) =>
  siteSections
    .find((section) => section.id === "docs")!
    .groups.find((group) => group.label === label)!.slugs;

const sidebarOrder = async (directory: string) => {
  const pages: { slug: string; order: number; title: string }[] = [];
  for (const file of await contentFiles()) {
    if (!file.startsWith(`${directory}/`)) continue;
    const source = await readFile(join(contentDirectory, file), "utf8");
    const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "") ?? {};
    pages.push({
      slug: pageSlug(file),
      order: frontmatter.sidebar?.order ?? Number.POSITIVE_INFINITY,
      title: String(frontmatter.sidebar?.label ?? frontmatter.title ?? pageSlug(file)),
    });
  }
  return pages
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    .map((page) => page.slug);
};

describe("siteSections", () => {
  it("lists every hand-written page in exactly one group", async () => {
    const listed = listedSlugs();

    for (const slug of await handWrittenSlugs()) {
      expect(
        listed.filter((candidate) => candidate === slug),
        slug,
      ).toHaveLength(1);
    }
  });

  it("only lists pages that exist", async () => {
    const slugs = new Set(await handWrittenSlugs());

    expect(listedSlugs().filter((slug) => !slugs.has(slug))).toEqual([]);
  });

  it.each([
    ["Guides", "guides"],
    ["Integrations", "integrations"],
    ["Advanced", "advanced"],
  ])("orders the %s group by sidebar.order, then title", async (label, directory) => {
    expect(docsGroup(label)).toEqual(await sidebarOrder(directory));
  });
});

describe("sectionForPath", () => {
  it("finds the section of a listed page, with or without the trailing slash", () => {
    expect(sectionForPath("/guides/scheduling/")?.id).toBe("docs");
    expect(sectionForPath("/comparison/pg-boss")?.id).toBe("compare");
    expect(sectionForPath("/benchmarks/")?.id).toBe("benchmarks");
  });

  it("maps the API reference and changelog by prefix", () => {
    expect(sectionForPath("/api/core/functions/createclient/")?.id).toBe("api");
    expect(sectionForPath("/changelog/")?.id).toBe("changelog");
  });

  it("highlights no section on the home page or an unknown path", () => {
    expect(sectionForPath("/")).toBeUndefined();
    expect(sectionForPath("/no-such-page/")).toBeUndefined();
    expect(sectionForPath("/guides/no-such-guide/")).toBeUndefined();
  });
});
