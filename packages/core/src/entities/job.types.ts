export type JobStatus = "blocked" | "pending" | "running" | "completed";

export type Job<TJobId, TJobTypeName, TChainTypeName, TInput> = {
  id: TJobId;
  chainId: TJobId;
  typeName: TJobTypeName;
  chainTypeName: TChainTypeName;
  chainIndex: number;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running"; leasedBy?: string; leasedUntil?: Date }
  | { status: "completed"; completedAt: Date; completedBy: string | null }
);

export type JobWithBlockers<
  TJob extends Job<any, any, any, any>,
  TBlockerChains extends any[],
> = TJob & { blockers: TBlockerChains };

type AnyJob = Job<any, any, any, any> | JobWithBlockers<Job<any, any, any, any>, any[]>;

export type PendingJob<TJob extends AnyJob> = TJob & { status: "pending" };
export type BlockedJob<TJob extends AnyJob> = TJob & { status: "blocked" };
export type CreatedJob<TJob extends AnyJob> = PendingJob<TJob> | BlockedJob<TJob>;
export type RunningJob<TJob extends AnyJob> = TJob & { status: "running" };
export type CompletedJob<TJob extends AnyJob> = TJob & { status: "completed" };
