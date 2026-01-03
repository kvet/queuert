export type JobSequenceStatus = "blocked" | "pending" | "running" | "completed";

export type JobSequence<TJobId, TFirstJobTypeName, TInput, TOutput> = {
  id: TJobId;
  originId: TJobId | null;
  rootId: TJobId;
  firstJobTypeName: TFirstJobTypeName;
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
