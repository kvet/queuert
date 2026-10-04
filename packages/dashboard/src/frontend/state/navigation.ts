/**
 * In-app history tracking for "← Back" and breadcrumbs. The router stamps every history entry
 * with `history.state._depth`; entries deeper than the one the app was opened on (deep link,
 * reload, new tab) were pushed by the app, so a history-back from them stays inside it. Using the
 * depth rather than a "has navigated" flag keeps this right after browser back/forward too.
 */
export const createHistoryTracker = (
  currentDepth: () => number | null,
): {
  recordLocation: (location: string) => void;
  canGoBack: () => boolean;
  previousLocation: () => string | null;
} => {
  // Depth of the entry the app was opened on; read on the first route, once the router stamped it.
  let entryDepth: number | null = null;
  // The in-app location (router path + query) recorded for each history depth.
  const locations = new Map<number, string>();

  const canGoBack = () => {
    const depth = currentDepth();
    return depth !== null && entryDepth !== null && depth > entryDepth;
  };

  return {
    recordLocation: (location) => {
      const depth = currentDepth();
      if (depth === null) return;
      entryDepth ??= depth;
      locations.set(depth, location);
    },
    canGoBack,
    previousLocation: () => {
      const depth = currentDepth();
      return canGoBack() && depth !== null ? (locations.get(depth - 1) ?? null) : null;
    },
  };
};

const routerDepth = (): number | null => {
  const depth: unknown = (window.history.state as { _depth?: unknown } | null)?._depth;
  return typeof depth === "number" ? depth : null;
};

const tracker = createHistoryTracker(routerDepth);

/** Records the current location; `App` calls it on every route change. */
export const recordLocation: (location: string) => void = tracker.recordLocation;

/** Whether the previous history entry is part of the app, so a history-back is safe. */
export const canGoBack: () => boolean = tracker.canGoBack;

/**
 * The in-app location the user came from, so a breadcrumb that points at that list can
 * history-back to it and keep its filters instead of opening a bare list.
 */
export const previousLocation: () => string | null = tracker.previousLocation;
