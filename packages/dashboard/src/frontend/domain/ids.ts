export const MAX_IDS = 100;

/** `first8…last4` for IDs longer than 16 characters; shorter IDs are returned unchanged. */
export const shortId = (id: string): string =>
  id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;

/**
 * Splits free text into IDs on commas, whitespace and newlines, trimming and deduplicating them.
 * Keeps at most {@link MAX_IDS}; `overLimit` reports whether any were dropped.
 */
export const parseIdList = (text: string): { ids: string[]; overLimit: boolean } => {
  const unique = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
  return { ids: unique.slice(0, MAX_IDS), overLimit: unique.length > MAX_IDS };
};
