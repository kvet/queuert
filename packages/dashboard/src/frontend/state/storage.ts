/**
 * Storage key namespaced per mount point: the dashboard shares its origin with the host app, and
 * two dashboards mounted at different base paths must not share preferences.
 */
export const storageKey = (basePath: string, name: string): string =>
  `queuert-dashboard:${basePath || "/"}:${name}`;

export const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStored = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the preference just won't persist.
  }
};
