/** Possible statuses of a chain. Derived from the status of its latest job. */
export type ChainStatus = "pending" | "running" | "completed";

/**
 * A chain. Discriminated union on {@link Chain.status | status}.
 *
 * A chain is identified by the ID of its first job. Its status is derived from the latest job in the chain.
 *
 * @typeParam TJobId - The job ID type
 * @typeParam TChainTypeName - The chain type name literal (matches the entry job type name)
 * @typeParam TInput - The chain's input payload type (from the entry job)
 * @typeParam TOutput - The chain's output type (from the final job when completed)
 */
export type Chain<TJobId, TChainTypeName, TInput, TOutput> = {
  /** Chain ID (same as the first job's ID). */
  id: TJobId;
  /** Chain type name (matches the entry job type name). */
  typeName: TChainTypeName;
  /** Input payload provided when the chain was started. */
  input: TInput;
  createdAt: Date;
} & (
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; output: TOutput; completedAt: Date }
);

/** A chain narrowed to `"completed"` status. */
export type CompletedChain<TChain extends Chain<any, any, any, any>> = TChain & {
  status: "completed";
};
