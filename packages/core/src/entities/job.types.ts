/** Possible statuses of a job. */
export type JobStatus = "blocked" | "scheduled" | "ready" | "running" | "succeeded" | "completed";

/**
 * A job within a chain. Discriminated union on {@link Job.status | status}.
 *
 * The six states are derived (never stored) from the job's structural columns:
 * - `blocked` — has at least one open blocker chain.
 * - `scheduled` — eligible for processing in the future (`scheduledAt > now`).
 * - `ready` — eligible for processing now.
 * - `running` — currently leased by a worker.
 * - `succeeded` — handed off to a successor via `continueWith` (carries `continuedToJobId`).
 * - `completed` — terminally completed (carries `output`).
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
  | { status: "blocked" }
  | { status: "scheduled" }
  | { status: "ready" }
  | { status: "running"; leasedBy: string; leasedUntil: Date }
  | (TCanContinue extends true
      ? {
          status: "succeeded";
          completedAt: Date;
          completedBy: string | null;
          continuedToJobId: TJobId;
        }
      : never)
  | ([TOutput] extends [never]
      ? never
      : {
          status: "completed";
          completedAt: Date;
          completedBy: string | null;
          output: TOutput;
        })
);
