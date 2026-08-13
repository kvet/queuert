/**
 * Options for chain deduplication.
 *
 * When provided to `createChain`, the system checks for existing chains with the same key
 * and returns them instead of creating a new one.
 */
export type DeduplicationOptions = {
  /** Unique key for deduplication matching. */
  key: string;
  /** Which existing chains to match against. */
  scope: "running" | "any";
};
