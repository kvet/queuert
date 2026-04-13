const base = document.querySelector("base")?.getAttribute("href") ?? "/";
export const basePath: string = base.replace(/\/$/, "");
