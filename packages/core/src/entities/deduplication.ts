/**
 * Scope for deduplication matching.
 *
 * - `"incomplete"` — match only chains that have not completed yet (default).
 * - `"any"` — match any chain with the same key, regardless of status.
 */
export type DeduplicationScope = "incomplete" | "any";

/**
 * Options for job chain deduplication.
 *
 * When provided to `startJobChain`, the system checks for existing chains with the same key
 * and returns them instead of creating a new one.
 */
export type DeduplicationOptions = {
  /** Unique key for deduplication matching. */
  key: string;
  /** Which existing chains to match against. Defaults to `"incomplete"`. */
  scope?: "incomplete" | "any";
  /** Time window in milliseconds — only chains created within this window are matched. */
  windowMs?: number;
};
