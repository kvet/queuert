/**
 * Options for job chain deduplication.
 *
 * When provided to `startJobChain`, the system checks for existing chains with the same key
 * and returns them instead of creating a new one.
 */
export type DeduplicationOptions<TJobId> = {
  /** Unique key for deduplication matching. */
  key: string;
  /** Which existing chains to match against. Defaults to `"incomplete"`. */
  scope?: "incomplete" | "any";
  /** Time window in milliseconds — only chains created within this window are matched. */
  windowMs?: number;
  /** Job chain IDs to exclude from deduplication matching. Useful for recurring jobs that self-schedule within a completion callback where the current chain is still incomplete. */
  excludeJobChainIds?: TJobId[];
};
