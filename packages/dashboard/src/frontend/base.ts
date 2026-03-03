const base = document.querySelector("base")?.getAttribute("href") ?? "/";
export const basePath = base.replace(/\/$/, "");
