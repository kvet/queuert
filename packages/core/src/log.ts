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

type WorkerBasicArgs = { workerId: string | null };
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

export type JobBasicArgs = {
  id: string;
  typeName: string;
  originId: string | null;
  sequenceId: string;
  rootId: string;
};
export type JobProcessingArgs = JobBasicArgs & { status: StateJob["status"]; attempt: number };
type JobCreatedLogEntry = LogEntry<
  "job_created",
  "info",
  "Job created",
  [
    {
      input: unknown;
      blockers: JobSequenceArgs[];
      scheduledAt?: Date;
      scheduleAfterMs?: number;
    } & JobBasicArgs,
  ]
>;
type JobAttemptStartedLogEntry = LogEntry<
  "job_attempt_started",
  "info",
  "Job attempt started",
  [JobProcessingArgs & WorkerBasicArgs]
>;
type JobTakenByAnotherWorkerLogEntry = LogEntry<
  "job_taken_by_another_worker",
  "warn",
  "Job taken by another worker",
  [{ leasedBy: string; leasedUntil: Date } & JobProcessingArgs & WorkerBasicArgs]
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
  [
    { rescheduledAfterMs?: number; rescheduledAt?: Date } & JobProcessingArgs & WorkerBasicArgs,
    unknown,
  ]
>;
type JobCompletedLogEntry = LogEntry<
  "job_completed",
  "info",
  "Job completed",
  [{ output?: unknown; continuedWith?: JobBasicArgs } & JobProcessingArgs & WorkerBasicArgs]
>;

export type JobSequenceArgs = {
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

type JobBlockedLogEntry = LogEntry<
  "job_blocked",
  "info",
  "Job blocked by incomplete sequences",
  [{ blockedBySequences: JobSequenceArgs[] } & JobBasicArgs]
>;
type JobUnblockedLogEntry = LogEntry<
  "job_unblocked",
  "info",
  "Job unblocked",
  [{ unblockedBySequence: JobSequenceArgs } & JobBasicArgs]
>;

type NotifyContextAbsenceLogEntry = LogEntry<
  "notify_context_absence",
  "warn",
  "Not withNotify context when creating job for queue. The job processing may be delayed.",
  [JobBasicArgs]
>;
type NotifyAdapterErrorLogEntry = LogEntry<
  "notify_adapter_error",
  "warn",
  "Notify adapter error",
  [{ operation: string }, unknown]
>;

type StateAdapterErrorLogEntry = LogEntry<
  "state_adapter_error",
  "warn",
  "State adapter error",
  [{ operation: string }, unknown]
>;

type TypedLogEntry =
  // worker
  | WorkerStartedLogEntry
  | WorkerErrorLogEntry
  | WorkerStoppingLogEntry
  | WorkerStoppedLogEntry
  // job
  | JobCreatedLogEntry
  | JobAttemptStartedLogEntry
  | JobTakenByAnotherWorkerLogEntry
  | JobLeaseExpiredLogEntry
  | JobReapedLogEntry
  | JobAttemptFailedLogEntry
  | JobCompletedLogEntry
  // job sequence
  | JobSequenceCreatedLogEntry
  | JobSequenceCompletedLogEntry
  | JobSequenceDeletedLogEntry
  // blockers
  | JobBlockedLogEntry
  | JobUnblockedLogEntry
  // notify adapter
  | NotifyContextAbsenceLogEntry
  | NotifyAdapterErrorLogEntry
  // state adapter
  | StateAdapterErrorLogEntry;

export type Log = (options: TypedLogEntry) => void;
