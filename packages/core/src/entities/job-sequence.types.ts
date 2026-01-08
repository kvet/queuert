export type JobSequenceStatus = "blocked" | "pending" | "running" | "completed";

export type JobSequence<TJobId, TSequenceTypeName, TInput, TOutput> = {
  id: TJobId;
  typeName: TSequenceTypeName;
  rootSequenceId: TJobId;
  originId: TJobId | null;
  input: TInput;
  createdAt: Date;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; output: TOutput; completedAt: Date }
);

export type CompletedJobSequence<TJobSequence extends JobSequence<any, any, any, any>> =
  TJobSequence & {
    status: "completed";
  };
