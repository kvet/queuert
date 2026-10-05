/** Possible statuses of a job. A `blocked` job is waiting on incomplete blocker chains. */
export type JobStatus = "blocked" | "pending" | "running" | "completed";

/** Fields shared by every {@link Job} status variant. */
export type JobFields<TJobId, TJobTypeName, TChainTypeName, TInput> = {
  id: TJobId;
  /** ID of the chain this job belongs to (equals `id` for the head job). */
  chainId: TJobId;
  typeName: TJobTypeName;
  /** Type name of the chain this job belongs to. */
  chainTypeName: TChainTypeName;
  /** Position in the chain: 0 for the head job, incrementing for each continuation. */
  chainIndex: number;
  input: TInput;
  createdAt: Date;
  /** When the job becomes eligible for processing. */
  scheduledAt: Date;
  /** Number of processing attempts so far. */
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
};

/** Status fields of a `blocked` {@link Job}. @inline */
export type BlockedJobFields = {
  status: "blocked";
};

/** Status fields of a `pending` {@link Job}. @inline */
export type PendingJobFields = {
  status: "pending";
};

/** Status fields of a `running` {@link Job}. @inline */
export type RunningJobFields = {
  status: "running";
  /** When the current attempt started. */
  attemptAt: Date;
  /** Worker that owns the current attempt. */
  attemptBy: string;
  /**
   * Attempt lease deadline. Set when the job is acquired (now plus the type's
   * `attemptConfig.timeoutMs`), then extended by heartbeats while the handler runs.
   */
  attemptUntil: Date | null;
};

/** Status fields shared by both `completed` {@link Job} variants. @inline */
export type CompletedJobFields = {
  status: "completed";
  completedAt: Date;
  completedBy: string | null;
};

/** Fields of a terminally completed {@link Job}: carries `output`, has no successor. */
export type TerminalJobFields<TOutput> = { output: TOutput; continuedToId: null };

/** Fields of a continued {@link Job}: no `output`, `continuedToId` points at the successor. */
export type ContinuedJobFields<TJobId> = { output?: never; continuedToId: TJobId };

/**
 * A job within a chain. Discriminated union on {@link Job.status | status},
 * with `completed` further split into a *terminal* variant (carries `output`,
 * `continuedToId === null`) and a *continued* variant (no `output`,
 * `continuedToId` points at the successor job).
 *
 * @typeParam TJobId - The job ID type (e.g. `string` or `UUID`)
 * @typeParam TJobTypeName - The job type name literal
 * @typeParam TChainTypeName - The chain type name literal
 * @typeParam TInput - The job's input payload type
 * @typeParam TOutput - The job's output type (available when terminally completed)
 */
export type Job<
  TJobId,
  TJobTypeName,
  TChainTypeName,
  TInput,
  TOutput,
  TCanContinue extends boolean,
> = JobFields<TJobId, TJobTypeName, TChainTypeName, TInput> &
  (
    | BlockedJobFields
    | PendingJobFields
    | RunningJobFields
    | (CompletedJobFields &
        (
          | ([TOutput] extends [never] ? never : TerminalJobFields<TOutput>)
          | (TCanContinue extends true ? ContinuedJobFields<TJobId> : never)
        ))
  );

export type AnyJob = Job<any, any, any, any, any, boolean>;

/** A job narrowed to `"completed"` status. */
export type CompletedJob<TJob extends AnyJob> = Extract<
  TJob,
  {
    status: "completed";
  }
>;
