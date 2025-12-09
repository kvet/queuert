import { StateJob } from "./state-adapter/state-adapter.js";

type LogLevel = "info" | "warn" | "error";
type LogEntry<
  TType extends string,
  TLevel extends LogLevel,
  TMessage extends string,
  TArgs extends any[],
> = {
  type: TType;
  level: TLevel;
  message: TMessage;
  args: TArgs;
};

type WorkerBasicArgs = { workerId: string };
type WorkerStartedLogEntry = LogEntry<
  "worker_started",
  "info",
  "Started worker",
  [{ queueNames: string[] } & WorkerBasicArgs]
>;
type WorkerErrorLogEntry = LogEntry<
  "worker_error",
  "error",
  "Worker error",
  [WorkerBasicArgs, unknown]
>;
type WorkerStoppingLogEntry = LogEntry<
  "worker_stopping",
  "info",
  "Stopping worker...",
  [WorkerBasicArgs]
>;
type WorkerStoppedLogEntry = LogEntry<
  "worker_stopped",
  "info",
  "Worker has been stopped",
  [WorkerBasicArgs]
>;

type JobBasicArgs = {
  jobId: string;
  queueName: string;
  originId: string | null;
  chainId: string;
  rootId: string;
};
type JobProcessingArgs = JobBasicArgs & { status: StateJob["status"]; attempt: number };
type JobCreatedLogEntry = LogEntry<
  "job_created",
  "info",
  "Job created",
  [{ input: unknown } & JobBasicArgs]
>;
type JobAcquiredLogEntry = LogEntry<
  "job_acquired",
  "info",
  "Job acquired",
  [JobProcessingArgs & WorkerBasicArgs]
>;
type JobLeaseExpiredLogEntry = LogEntry<
  "job_lease_expired",
  "warn",
  "Job lease expired",
  [{ lockedBy: string; lockedUntil: Date } & JobProcessingArgs & WorkerBasicArgs]
>;
type JobReapedLogEntry = LogEntry<
  "job_reaped",
  "info",
  "Reaped expired job claim",
  [{ lockedBy: string; lockedUntil: Date } & JobBasicArgs & WorkerBasicArgs]
>;
type JobAttemptFailedLogEntry = LogEntry<
  "job_attempt_failed",
  "error",
  "Job attempt failed",
  [{ rescheduledAfterMs: number } & JobProcessingArgs & WorkerBasicArgs, unknown]
>;
type JobCompletedLogEntry = LogEntry<
  "job_completed",
  "info",
  "Job completed",
  [{ output: unknown } & JobProcessingArgs & WorkerBasicArgs]
>;

type JobChainArgs = { chainId: string; chainName: string; originId: string | null; rootId: string };
type JobChainCreatedLogEntry = LogEntry<
  "job_chain_created",
  "info",
  "Job chain created",
  [JobChainArgs & { input: unknown }]
>;
type JobChainCompletedLogEntry = LogEntry<
  "job_chain_completed",
  "info",
  "Job chain completed",
  [{ output: unknown } & JobChainArgs]
>;

type JobBlockersAddedLogEntry = LogEntry<
  "job_blockers_added",
  "info",
  "Job blockers added",
  [{ blockers: JobChainArgs[] } & JobProcessingArgs]
>;
type JobBlockedLogEntry = LogEntry<
  "job_blocked",
  "info",
  "Job is blocked",
  [JobProcessingArgs & { incompleteBlockers: JobChainArgs[] }]
>;
type JobChainUnblockedJobsLogEntry = LogEntry<
  "job_chain_unblocked_jobs",
  "info",
  "Job chain completed and unblocked jobs",
  [{ unblockedJobs: JobBasicArgs[] } & JobChainArgs]
>;

type NotifyContextAbsenceLogEntry = LogEntry<
  "notify_context_absence",
  "warn",
  "Not withNotify context when enqueueing job for queue. The job processing may be delayed.",
  [JobBasicArgs]
>;

type TypedLogEntry =
  // worker
  | WorkerStartedLogEntry
  | WorkerErrorLogEntry
  | WorkerStoppingLogEntry
  | WorkerStoppedLogEntry
  // job
  | JobCreatedLogEntry
  | JobAcquiredLogEntry
  | JobLeaseExpiredLogEntry
  | JobReapedLogEntry
  | JobAttemptFailedLogEntry
  | JobCompletedLogEntry
  // job chain
  | JobChainCreatedLogEntry
  | JobChainCompletedLogEntry
  // blockers
  | JobBlockersAddedLogEntry
  | JobBlockedLogEntry
  | JobChainUnblockedJobsLogEntry
  // notify
  | NotifyContextAbsenceLogEntry;

export type Log = (options: TypedLogEntry) => void;
