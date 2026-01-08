export type JobStatus = "blocked" | "pending" | "running" | "completed";

export type Job<TJobId, TJobTypeName, TInput, TBlockerSequences extends any[]> = {
  id: TJobId;
  sequenceId: TJobId;
  originId: TJobId | null;
  rootSequenceId: TJobId;
  typeName: TJobTypeName;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  updatedAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
  blockers: TBlockerSequences;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running"; leasedBy?: string; leasedUntil?: Date }
  | { status: "completed"; completedAt: Date; completedBy: string | null }
);

export type JobWithoutBlockers<TJob extends Job<any, any, any, any>> = TJob extends any
  ? Omit<TJob, "blockers">
  : never;

type AnyJob = Job<any, any, any, any> | Omit<Job<any, any, any, any>, "blockers">;

export type PendingJob<TJob extends AnyJob> = TJob & { status: "pending" };
export type BlockedJob<TJob extends AnyJob> = TJob & { status: "blocked" };
export type CreatedJob<TJob extends AnyJob> = PendingJob<TJob> | BlockedJob<TJob>;
export type RunningJob<TJob extends AnyJob> = TJob & { status: "running" };
export type CompletedJob<TJob extends AnyJob> = TJob & { status: "completed" };
