/** Possible statuses of a job. */
export type JobStatus = "pending" | "running" | "completed";

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
> = {
  id: TJobId;
  /** ID of the chain this job belongs to (equals `id` for the first job). */
  chainId: TJobId;
  typeName: TJobTypeName;
  /** Type name of the chain this job belongs to. */
  chainTypeName: TChainTypeName;
  input: TInput;
  createdAt: Date;
  /** When the job becomes eligible for processing. */
  scheduledAt: Date;
  /** Number of processing attempts so far. */
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | {
      status: "pending";
      blocked: boolean;
    }
  | {
      status: "running";
      /** When the current attempt started. Non-null by construction — `running` is derived from it. */
      attemptAt: Date;
      /** Worker that owns the current attempt. Always written alongside `attemptAt`. */
      attemptBy: string;
      /** Attempt deadline. Null until the worker's first heartbeat extends the attempt. */
      attemptUntil: Date | null;
    }
  | ({
      status: "completed";
      completedAt: Date;
      completedBy: string | null;
    } & (
      | ([TOutput] extends [never] ? never : { output: TOutput; continuedToId: null })
      | (TCanContinue extends true ? { output?: never; continuedToId: TJobId } : never)
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
