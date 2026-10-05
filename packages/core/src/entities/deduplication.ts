/**
 * Options for chain deduplication.
 *
 * When provided to `createChain`, the system checks for an existing chain of the same
 * `typeName` with the same key and returns it instead of creating a new one.
 */
export type DeduplicationOptions = {
  /** Deduplication key, matched together with the chain's `typeName`. */
  key: string;
  /**
   * Which existing chains to match against: `"running"` matches only chains that have not
   * completed, so a new chain can start once the previous one completes; `"any"` matches
   * completed chains too.
   */
  scope: "running" | "any";
};
