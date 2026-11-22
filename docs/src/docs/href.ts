const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const siteHref = (path: string): string => `${basePath}${path}`;
