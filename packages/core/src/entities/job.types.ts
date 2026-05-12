/** Possible statuses of a job. */
export type JobStatus = "pending" | "running" | "completed";

/**
 * A job within a chain. Discriminated union on {@link Job.status | status},
 * with `completed` further split into a *terminal* variant (carries `output`,
 * `continuedToJobId === null`) and a *continued* variant (no `output`,
 * `continuedToJobId` points at the successor job).
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
  | { status: "pending" }
  | { status: "running"; leasedBy?: string; leasedUntil?: Date }
  | {
      status: "completed";
      completedAt: Date;
      completedBy: string | null;
      continuedToJobId: null;
      output: TOutput;
    }
  | (TCanContinue extends true
      ? {
          status: "completed";
          completedAt: Date;
          completedBy: string | null;
          continuedToJobId: TJobId;
          output?: never;
        }
      : never)
);
