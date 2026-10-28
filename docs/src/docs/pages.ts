import { type Component } from "solid-js";
import pages from "virtual:docs-pages";

import { type SiteSection, apiPackages, siteSections } from "./sections.ts";

export type DocPage = (typeof pages)[number];

export type DocHeading = { depth: number; text: string; id: string };

export type DocModule = {
  default: Component<{ components?: Record<string, unknown> }>;
  headings: DocHeading[];
};

const modules = import.meta.glob<DocModule>("../content/docs/**/*.{tsx,md,mdx}");

export const pageHref = (page: DocPage): string => (page.slug === "" ? "/" : `/${page.slug}/`);

const bySlug = new Map(pages.map((page) => [page.slug, page]));

export const findPage = (slug: string): DocPage | undefined =>
  bySlug.get(slug.replace(/^\/+|\/+$/g, "").toLowerCase());

export const loadPage = async (page: DocPage): Promise<DocModule> => {
  const load = modules[`../content/docs/${page.file}`];
  if (!load) throw new Error(`No module for docs page ${page.file}`);
  return load();
};

type NavGroup = { label: string; pages: DocPage[] };

export const sectionGroups = (section: SiteSection): NavGroup[] =>
  section.groups.map((group) => ({
    label: group.label,
    pages: group.slugs.flatMap((slug) => bySlug.get(slug) ?? []),
  }));

const kindOrder = ["Function", "Class", "Type", "Interface", "Variable", "Enum"];

export const kindLabels: Record<string, string> = {
  Function: "Functions",
  Class: "Classes",
  Type: "Types",
  Interface: "Interfaces",
  Variable: "Variables",
  Enum: "Enums",
};

export type ApiPackage = (typeof apiPackages)[number] & {
  index: DocPage | undefined;
  kinds: { kind: string; pages: DocPage[] }[];
  size: number;
};

export const apiTree: ApiPackage[] = apiPackages.map((pkg) => {
  const symbols = pages.filter(
    (page) => page.api?.package === pkg.slug && page.slug !== `api/${pkg.slug}/readme`,
  );
  return {
    ...pkg,
    index: bySlug.get(`api/${pkg.slug}/readme`),
    size: symbols.length,
    kinds: kindOrder
      .map((kind) => ({
        kind,
        pages: symbols
          .filter((page) => page.api?.kind === kind)
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .filter((group) => group.pages.length > 0),
  };
});

export const apiPackageOf = (page: DocPage): ApiPackage | undefined =>
  page.api ? apiTree.find((pkg) => pkg.slug === page.api!.package) : undefined;

export const trail = (page: DocPage): string[] => {
  const pkg = apiPackageOf(page);
  if (pkg)
    return [
      "API",
      pkg.label,
      ...(page.api!.kind ? [kindLabels[page.api!.kind] ?? page.api!.kind] : []),
    ];
  for (const section of siteSections) {
    const group = section.groups.find((candidate) => candidate.slugs.includes(page.slug));
    if (group)
      return group.label === section.label ? [section.label] : [section.label, group.label];
  }
  return [];
};

const orderedFor = (page: DocPage): DocPage[] => {
  const pkg = apiPackageOf(page);
  if (pkg) return [...(pkg.index ? [pkg.index] : []), ...pkg.kinds.flatMap((kind) => kind.pages)];
  const section = siteSections.find((candidate) =>
    candidate.groups.some((group) => group.slugs.includes(page.slug)),
  );
  return section ? sectionGroups(section).flatMap((group) => group.pages) : [];
};

export const neighbors = (page: DocPage): { previous?: DocPage; next?: DocPage } => {
  const ordered = orderedFor(page);
  const index = ordered.indexOf(page);
  if (index === -1) return {};
  return { previous: ordered[index - 1], next: ordered[index + 1] };
};
