import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { pageSlug } from "../../plugins/mdx.ts";
import { drawerSections, sectionForPath, siteSections, topBarSections } from "./sections.ts";

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

const sectionSlugs = (id: string) =>
  siteSections.find((section) => section.id === id)!.groups.flatMap((group) => group.slugs);

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
    ["guides", "guides"],
    ["concepts", "how-it-works"],
  ])("orders the %s section by sidebar.order, then title", async (id, directory) => {
    const slugs = sectionSlugs(id).filter((slug) => slug !== directory);

    expect(slugs).toEqual((await sidebarOrder(directory)).filter((slug) => slugs.includes(slug)));
  });

  it("opens Guides, Compare, Integrations and the Blog with their overview, listed without a heading", () => {
    for (const [id, overview] of [
      ["guides", "guides"],
      ["compare", "comparison"],
      ["integrations", "integrations"],
      ["blog", "blog"],
    ] as const) {
      const [first] = siteSections.find((section) => section.id === id)!.groups;

      expect(first).toEqual({ label: "", slugs: [overview] });
    }
  });

  it("lists the Learn pages in lesson order", () => {
    expect(sectionSlugs("learn")).toEqual([
      "learn",
      "learn/what-is-queuert",
      "learn/first-chain",
      "learn/transactional-outbox",
      "learn/errors-and-retries",
      "learn/transactional-completion",
      "learn/continuing-a-chain",
      "learn/job-blockers",
      "learn/use-it-in-your-app",
    ]);
  });

  it("starts Concepts with the glossary", () => {
    expect(sectionSlugs("concepts")[0]).toBe("how-it-works/glossary");
  });

  it("lists the benchmarks inside Compare", () => {
    expect(sectionSlugs("compare")).toContain("benchmarks/runtime-performance");
  });
});

const postDates = async () => {
  const dates = new Map<string, string>();
  for (const file of await contentFiles()) {
    if (!file.startsWith("blog/") || file.startsWith("blog/index.")) continue;
    const source = await readFile(join(contentDirectory, file), "utf8");
    const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "") ?? {};
    dates.set(pageSlug(file), String(frontmatter.date));
  }
  return dates;
};

describe("blog", () => {
  it("dates every post and lists the posts newest first", async () => {
    const dates = await postDates();
    const posts = siteSections
      .find((section) => section.id === "blog")!
      .groups.find((group) => group.label === "Posts")!.slugs;

    expect([...dates.values()].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true);
    expect(posts).toEqual(
      [...dates.keys()].sort((a, b) => dates.get(b)!.localeCompare(dates.get(a)!)),
    );
  });
});

describe("sectionForPath", () => {
  it("finds the section of a listed page, with or without the trailing slash", () => {
    expect(sectionForPath("/learn/")?.id).toBe("learn");
    expect(sectionForPath("/guides/")?.id).toBe("guides");
    expect(sectionForPath("/guides/scheduling/")?.id).toBe("guides");
    expect(sectionForPath("/how-it-works/glossary/")?.id).toBe("concepts");
    expect(sectionForPath("/comparison/pg-boss")?.id).toBe("compare");
    expect(sectionForPath("/integrations/state-adapters/postgres/")?.id).toBe("integrations");
    expect(sectionForPath("/benchmarks/processing-capacity/")?.id).toBe("compare");
    expect(sectionForPath("/blog/dual-write-problem/")?.id).toBe("blog");
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

describe("topBarSections", () => {
  it("lists every section but the blog and the changelog", () => {
    expect(topBarSections.map((section) => section.id)).toEqual([
      "learn",
      "guides",
      "concepts",
      "integrations",
      "api",
      "compare",
    ]);
  });

  it("adds the blog to the drawer", () => {
    expect(drawerSections.map((section) => section.id).at(-1)).toBe("blog");
  });
});
