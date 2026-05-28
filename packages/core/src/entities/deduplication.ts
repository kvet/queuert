/**
 * Options for chain deduplication.
 *
 * When provided to `startChain`, the system checks for existing chains with the same key
 * and returns them instead of creating a new one.
 */
export type DeduplicationOptions<TJobId> = {
  /** Unique key for deduplication matching. */
  key: string;
  /** Which existing chains to match against. `"open"` matches only chains that are not yet closed; `"any"` matches regardless. Defaults to `"open"`. */
  scope?: "open" | "any";
  /** Time window in milliseconds — only chains created within this window are matched. */
  windowMs?: number;
  /** Chain IDs to exclude from deduplication matching. Useful for recurring jobs that self-schedule within a completion callback where the current chain is still open. */
  excludeChainIds?: TJobId[];
};
