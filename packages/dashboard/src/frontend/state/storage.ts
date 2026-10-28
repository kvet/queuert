export const storageKey = (basePath: string, name: string): string =>
  `queuert-dashboard:${basePath || "/"}:${name}`;
