const base = document.querySelector("base")?.getAttribute("href") ?? "/";
export const basePath: string = base.replace(/\/$/, "");

export const toLocalPath = (pathname: string): string => pathname.slice(basePath.length) || "/";
