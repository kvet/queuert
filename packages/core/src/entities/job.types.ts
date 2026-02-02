export type JobStatus = "blocked" | "pending" | "running" | "completed";

export type Job<TJobId, TJobTypeName, TChainTypeName, TInput, TBlockerChains extends any[]> = {
  id: TJobId;
  chainId: TJobId;
  typeName: TJobTypeName;
  chainTypeName: TChainTypeName;
  rootChainId: TJobId;
  originId: TJobId | null;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
  blockers: TBlockerChains;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running"; leasedBy?: string; leasedUntil?: Date }
  | { status: "completed"; completedAt: Date; completedBy: string | null }
);

export type JobWithoutBlockers<TJob extends Job<any, any, any, any, any[]>> = TJob extends any
  ? Omit<TJob, "blockers">
  : never;

type AnyJob = Job<any, any, any, any, any[]> | Omit<Job<any, any, any, any, any[]>, "blockers">;

export type PendingJob<TJob extends AnyJob> = TJob & { status: "pending" };
export type BlockedJob<TJob extends AnyJob> = TJob & { status: "blocked" };
export type CreatedJob<TJob extends AnyJob> = PendingJob<TJob> | BlockedJob<TJob>;
export type RunningJob<TJob extends AnyJob> = TJob & { status: "running" };
export type CompletedJob<TJob extends AnyJob> = TJob & { status: "completed" };
