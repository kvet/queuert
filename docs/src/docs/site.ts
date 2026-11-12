export const siteUrl = "https://kvet.github.io/queuert/";

export const siteName = "Queuert";

export const siteDescription =
  "Durable, typed job chains that commit with your database transactions.";

export const absoluteUrl = (path: string): string =>
  new URL(path.replace(/^\/+/, ""), siteUrl).href;
