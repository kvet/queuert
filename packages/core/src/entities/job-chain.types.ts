export type JobChainStatus = "blocked" | "pending" | "running" | "completed";

export type JobChain<TJobId, TChainTypeName, TInput, TOutput> = {
  id: TJobId;
  typeName: TChainTypeName;
  input: TInput;
  createdAt: Date;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; output: TOutput; completedAt: Date }
);

export type CompletedJobChain<TJobChain extends JobChain<any, any, any, any>> = TJobChain & {
  status: "completed";
};
