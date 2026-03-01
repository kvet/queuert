/** Possible statuses of a job. */
export type JobStatus = "blocked" | "pending" | "running" | "completed";

/**
 * A job within a chain. Discriminated union on {@link Job.status | status}.
 *
 * @typeParam TJobId - The job ID type (e.g. `string` or `UUID`)
 * @typeParam TJobTypeName - The job type name literal
 * @typeParam TChainTypeName - The chain type name literal
 * @typeParam TInput - The job's input payload type
 */
export type Job<TJobId, TJobTypeName, TChainTypeName, TInput> = {
  id: TJobId;
  /** ID of the chain this job belongs to (equals `id` for the first job). */
  chainId: TJobId;
  typeName: TJobTypeName;
  /** Type name of the chain this job belongs to. */
  chainTypeName: TChainTypeName;
  /** Zero-based position within the chain. */
  chainIndex: number;
  input: TInput;
  createdAt: Date;
  /** When the job becomes eligible for processing. */
  scheduledAt: Date;
  /** Number of processing attempts so far. */
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running"; leasedBy?: string; leasedUntil?: Date }
  | { status: "completed"; completedAt: Date; completedBy: string | null }
);

/** A job with its resolved blocker chains attached. */
export type JobWithBlockers<
  TJob extends Job<any, any, any, any>,
  TBlockerChains extends any[],
> = TJob & { blockers: TBlockerChains };

type AnyJob = Job<any, any, any, any> | JobWithBlockers<Job<any, any, any, any>, any[]>;

/** A job narrowed to `"pending"` status. */
export type PendingJob<TJob extends AnyJob> = TJob & { status: "pending" };
/** A job narrowed to `"blocked"` status. */
export type BlockedJob<TJob extends AnyJob> = TJob & { status: "blocked" };
/** A newly created job — either pending or blocked. */
export type CreatedJob<TJob extends AnyJob> = PendingJob<TJob> | BlockedJob<TJob>;
/** A job narrowed to `"running"` status. */
export type RunningJob<TJob extends AnyJob> = TJob & { status: "running" };
/** A job narrowed to `"completed"` status. */
export type CompletedJob<TJob extends AnyJob> = TJob & { status: "completed" };
