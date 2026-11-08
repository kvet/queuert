export const dashboardStorageKey = (basePath: string, name: string): string =>
  `queuert-dashboard:${basePath || "/"}:${name}`;
