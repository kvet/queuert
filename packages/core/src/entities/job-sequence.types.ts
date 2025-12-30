export type JobSequenceStatus = "blocked" | "pending" | "running" | "completed";

export type JobSequence<TFirstJobTypeName, TInput, TOutput> = {
  id: string;
  originId: string | null;
  rootId: string;
  firstJobTypeName: TFirstJobTypeName;
  input: TInput;
  createdAt: Date;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; output: TOutput; completedAt: Date }
);

export type CompletedJobSequence<TJobSequence extends JobSequence<any, any, any>> = TJobSequence & {
  status: "completed";
};
