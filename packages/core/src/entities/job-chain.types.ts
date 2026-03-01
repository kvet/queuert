/** Possible statuses of a job chain. Derived from the status of its latest job. */
export type JobChainStatus = "blocked" | "pending" | "running" | "completed";

/**
 * A job chain. Discriminated union on {@link JobChain.status | status}.
 *
 * A chain is identified by the ID of its first job. Its status is derived from the latest job in the chain.
 *
 * @typeParam TJobId - The job ID type
 * @typeParam TChainTypeName - The chain type name literal (matches the entry job type name)
 * @typeParam TInput - The chain's input payload type (from the entry job)
 * @typeParam TOutput - The chain's output type (from the final job when completed)
 */
export type JobChain<TJobId, TChainTypeName, TInput, TOutput> = {
  /** Chain ID (same as the first job's ID). */
  id: TJobId;
  /** Chain type name (matches the entry job type name). */
  typeName: TChainTypeName;
  /** Input payload provided when the chain was started. */
  input: TInput;
  createdAt: Date;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; output: TOutput; completedAt: Date }
);

/** A job chain narrowed to `"completed"` status. */
export type CompletedJobChain<TJobChain extends JobChain<any, any, any, any>> = TJobChain & {
  status: "completed";
};
