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
  [{ jobTypeNames: string[] } & WorkerBasicArgs]
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
  id: string;
  typeName: string;
  originId: string | null;
  sequenceId: string;
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
  [{ leasedBy: string; leasedUntil: Date } & JobProcessingArgs & WorkerBasicArgs]
>;
type JobReapedLogEntry = LogEntry<
  "job_reaped",
  "info",
  "Reaped expired job lease",
  [{ leasedBy: string; leasedUntil: Date } & JobBasicArgs & WorkerBasicArgs]
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

type JobSequenceArgs = {
  sequenceId: string;
  firstJobTypeName: string;
  originId: string | null;
  rootId: string;
};
type JobSequenceCreatedLogEntry = LogEntry<
  "job_sequence_created",
  "info",
  "Job sequence created",
  [JobSequenceArgs & { input: unknown }]
>;
type JobSequenceCompletedLogEntry = LogEntry<
  "job_sequence_completed",
  "info",
  "Job sequence completed",
  [{ output: unknown } & JobSequenceArgs]
>;
type JobSequenceDeletedLogEntry = LogEntry<
  "job_sequence_deleted",
  "info",
  "Job sequence deleted",
  [{ deletedJobIds: string[] } & JobSequenceArgs]
>;

type JobBlockersAddedLogEntry = LogEntry<
  "job_blockers_added",
  "info",
  "Job blockers added",
  [{ blockers: JobSequenceArgs[] } & JobProcessingArgs]
>;
type JobBlockedLogEntry = LogEntry<
  "job_blocked",
  "info",
  "Job is blocked",
  [JobProcessingArgs & { incompleteBlockers: JobSequenceArgs[] }]
>;
type JobSequenceUnblockedJobsLogEntry = LogEntry<
  "job_sequence_unblocked_jobs",
  "info",
  "Job sequence completed and unblocked jobs",
  [{ unblockedJobs: JobBasicArgs[] } & JobSequenceArgs]
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
  // job sequence
  | JobSequenceCreatedLogEntry
  | JobSequenceCompletedLogEntry
  | JobSequenceDeletedLogEntry
  // blockers
  | JobBlockersAddedLogEntry
  | JobBlockedLogEntry
  | JobSequenceUnblockedJobsLogEntry
  // notify
  | NotifyContextAbsenceLogEntry;

export type Log = (options: TypedLogEntry) => void;
