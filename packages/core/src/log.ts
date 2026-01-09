import { StateJob } from "./state-adapter/state-adapter.js";

type LogLevel = "info" | "warn" | "error";
type LogEntry<
  TType extends string,
  TLevel extends LogLevel,
  TMessage extends string,
  TData extends Record<string, unknown>,
  TError extends unknown = never,
> = {
  type: TType;
  level: TLevel;
  message: TMessage;
  data: TData;
} & ([TError] extends [never] ? {} : { error: TError });

type WorkerBasicData = { workerId: string | null };
type WorkerStartedLogEntry = LogEntry<
  "worker_started",
  "info",
  "Started worker",
  { jobTypeNames: string[] } & WorkerBasicData
>;
type WorkerErrorLogEntry = LogEntry<
  "worker_error",
  "error",
  "Worker error",
  WorkerBasicData,
  unknown
>;
type WorkerStoppingLogEntry = LogEntry<
  "worker_stopping",
  "info",
  "Stopping worker...",
  WorkerBasicData
>;
type WorkerStoppedLogEntry = LogEntry<
  "worker_stopped",
  "info",
  "Worker has been stopped",
  WorkerBasicData
>;

export type JobBasicData = {
  id: string;
  typeName: string;
  originId: string | null;
  sequenceId: string;
  rootSequenceId: string;
};
export type JobProcessingData = JobBasicData & { status: StateJob["status"]; attempt: number };
type JobCreatedLogEntry = LogEntry<
  "job_created",
  "info",
  "Job created",
  {
    input: unknown;
    blockers: JobSequenceData[];
    scheduledAt?: Date;
    scheduleAfterMs?: number;
  } & JobBasicData
>;
type JobAttemptStartedLogEntry = LogEntry<
  "job_attempt_started",
  "info",
  "Job attempt started",
  JobProcessingData & WorkerBasicData
>;
type JobTakenByAnotherWorkerLogEntry = LogEntry<
  "job_taken_by_another_worker",
  "warn",
  "Job taken by another worker",
  { leasedBy: string; leasedUntil: Date } & JobProcessingData & WorkerBasicData
>;
type JobLeaseExpiredLogEntry = LogEntry<
  "job_lease_expired",
  "warn",
  "Job lease expired",
  { leasedBy: string; leasedUntil: Date } & JobProcessingData & WorkerBasicData
>;
type JobReapedLogEntry = LogEntry<
  "job_reaped",
  "info",
  "Reaped expired job lease",
  { leasedBy: string; leasedUntil: Date } & JobBasicData & WorkerBasicData
>;
type JobAttemptFailedLogEntry = LogEntry<
  "job_attempt_failed",
  "error",
  "Job attempt failed",
  { rescheduledAfterMs?: number; rescheduledAt?: Date } & JobProcessingData & WorkerBasicData,
  unknown
>;
type JobAttemptCompletedLogEntry = LogEntry<
  "job_attempt_completed",
  "info",
  "Job attempt completed",
  { output?: unknown; continuedWith?: JobBasicData } & JobProcessingData & WorkerBasicData
>;
type JobCompletedLogEntry = LogEntry<
  "job_completed",
  "info",
  "Job completed",
  { output?: unknown; continuedWith?: JobBasicData } & JobProcessingData & WorkerBasicData
>;

export type JobSequenceData = {
  id: string;
  typeName: string;
  originId: string | null;
  rootSequenceId: string;
};
type JobSequenceCreatedLogEntry = LogEntry<
  "job_sequence_created",
  "info",
  "Job sequence created",
  JobSequenceData & { input: unknown }
>;
type JobSequenceCompletedLogEntry = LogEntry<
  "job_sequence_completed",
  "info",
  "Job sequence completed",
  { output: unknown } & JobSequenceData
>;
type JobSequenceDeletedLogEntry = LogEntry<
  "job_sequence_deleted",
  "info",
  "Job sequence deleted",
  { deletedJobIds: string[] } & JobSequenceData
>;

type JobBlockedLogEntry = LogEntry<
  "job_blocked",
  "info",
  "Job blocked by incomplete sequences",
  { blockedBySequences: JobSequenceData[] } & JobBasicData
>;
type JobUnblockedLogEntry = LogEntry<
  "job_unblocked",
  "info",
  "Job unblocked",
  { unblockedBySequence: JobSequenceData } & JobBasicData
>;

type NotifyContextAbsenceLogEntry = LogEntry<
  "notify_context_absence",
  "warn",
  "Not withNotify context when creating job for queue. The job processing may be delayed.",
  JobBasicData
>;
type NotifyAdapterErrorLogEntry = LogEntry<
  "notify_adapter_error",
  "warn",
  "Notify adapter error",
  { operation: string },
  unknown
>;

type StateAdapterErrorLogEntry = LogEntry<
  "state_adapter_error",
  "warn",
  "State adapter error",
  { operation: string },
  unknown
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
  | JobAttemptCompletedLogEntry
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
