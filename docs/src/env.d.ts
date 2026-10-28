declare module "virtual:docs-pages" {
  // oxlint-disable-next-line typescript/consistent-type-imports -- ambient module declarations cannot import relative modules
  const pages: import("../plugins/content.ts").SourcePage[];
  export default pages;
}

declare module "virtual:changelog" {
  // oxlint-disable-next-line typescript/consistent-type-imports -- ambient module declarations cannot import relative modules
  const changelog: import("../plugins/changelog.ts").Changelog;
  export default changelog;
}

declare module "*?highlight" {
  const snippet: { code: string; lang: string; html: string };
  export default snippet;
}
