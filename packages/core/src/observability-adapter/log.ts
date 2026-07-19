import { type JobStatus } from "../entities/job.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";

type LogLevel = "info" | "warn" | "error";
type LogEntry<
  TType extends string,
  TLevel extends LogLevel,
  TMessage extends string,
  TData extends Record<string, unknown>,
  // oxlint-disable-next-line no-unnecessary-type-constraint
  TError extends unknown = never,
> = {
  type: TType;
  level: TLevel;
  message: TMessage;
  data: TData;
} & ([TError] extends [never] ? unknown : { error: TError });

export type WorkerBasicData = { workerId: string };
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

/** Basic job identification data included in log entries. */
export type JobBasicData = {
  id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;
};
export type JobProcessingData = JobBasicData & { status: JobStatus; attempt: number };
export type JobAttemptData = JobProcessingData & {
  attemptAt: Date;
  attemptBy: string;
  attemptUntil: Date;
};
type JobCreatedLogEntry = LogEntry<
  "job_created",
  "info",
  "Job created",
  {
    input: unknown;
    blockers: ChainData[];
    scheduledAt: Date;
  } & JobBasicData
>;
type JobAttemptStartedLogEntry = LogEntry<
  "job_attempt_started",
  "info",
  "Job attempt started",
  JobProcessingData & WorkerBasicData
>;
type JobAttemptTakenByAnotherWorkerLogEntry = LogEntry<
  "job_attempt_taken_by_another_worker",
  "warn",
  "Job taken by another worker",
  JobAttemptData & WorkerBasicData
>;
type JobAttemptAlreadyCompletedLogEntry = LogEntry<
  "job_attempt_already_completed",
  "warn",
  "Job already completed by another worker",
  { completedBy: string | null } & JobProcessingData & WorkerBasicData
>;
type JobAttemptExpiredLogEntry = LogEntry<
  "job_attempt_expired",
  "warn",
  "Job attempt expired",
  JobAttemptData & WorkerBasicData
>;
type JobAttemptExtendedLogEntry = LogEntry<
  "job_attempt_extended",
  "info",
  "Job attempt extended",
  JobAttemptData & WorkerBasicData
>;
type JobAttemptReclaimedLogEntry = LogEntry<
  "job_attempt_reclaimed",
  "info",
  "Reclaimed expired job attempt",
  JobAttemptData & WorkerBasicData
>;
type JobAttemptFailedLogEntry = LogEntry<
  "job_attempt_failed",
  "error",
  "Job attempt failed",
  JobProcessingData & WorkerBasicData,
  unknown
>;
export type JobCompletionData = JobProcessingData & {
  output?: unknown;
  continuedWith?: JobBasicData;
};
type JobAttemptCompletedLogEntry = LogEntry<
  "job_attempt_completed",
  "info",
  "Job attempt completed",
  JobCompletionData & WorkerBasicData
>;
type JobCompletedLogEntry = LogEntry<
  "job_completed",
  "info",
  "Job completed",
  JobCompletionData & { workerId: string | null }
>;

/** Chain identification data included in log entries. */
export type ChainData = {
  id: string;
  typeName: string;
};
type ChainCreatedLogEntry = LogEntry<
  "chain_created",
  "info",
  "Chain created",
  ChainData & { input: unknown }
>;
type ChainCompletedLogEntry = LogEntry<
  "chain_completed",
  "info",
  "Chain completed",
  { output: unknown } & ChainData
>;
type ChainDeletedLogEntry = LogEntry<"chain_deleted", "info", "Chain deleted", ChainData>;

type JobRescheduledLogEntry = LogEntry<
  "job_rescheduled",
  "info",
  "Job rescheduled",
  JobBasicData & { scheduledAt: Date }
>;

type JobBlockedLogEntry = LogEntry<
  "job_blocked",
  "info",
  "Job blocked by incomplete chains",
  { blockedByChains: ChainData[] } & JobBasicData
>;
type JobUnblockedLogEntry = LogEntry<
  "job_unblocked",
  "info",
  "Job unblocked",
  { unblockedByChain: ChainData } & JobBasicData
>;

type NotifyAdapterErrorLogEntry = LogEntry<
  "notify_adapter_error",
  "warn",
  "Notify adapter error",
  { operation: keyof NotifyAdapter },
  unknown
>;

type StateAdapterErrorLogEntry = LogEntry<
  "state_adapter_error",
  "warn",
  "State adapter error",
  { operation: keyof StateAdapter<any, any> },
  unknown
>;

type JobTypeValidationErrorLogEntry = LogEntry<
  "job_type_validation_error",
  "error",
  string, // Dynamic message from the error
  { code: string; typeName: string } & Record<string, unknown>,
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
  | JobAttemptTakenByAnotherWorkerLogEntry
  | JobAttemptAlreadyCompletedLogEntry
  | JobAttemptExpiredLogEntry
  | JobAttemptExtendedLogEntry
  | JobAttemptReclaimedLogEntry
  | JobAttemptFailedLogEntry
  | JobAttemptCompletedLogEntry
  | JobCompletedLogEntry
  // chain
  | ChainCreatedLogEntry
  | ChainCompletedLogEntry
  | ChainDeletedLogEntry
  // trigger
  | JobRescheduledLogEntry
  // blockers
  | JobBlockedLogEntry
  | JobUnblockedLogEntry
  // notify adapter
  | NotifyAdapterErrorLogEntry
  // state adapter
  | StateAdapterErrorLogEntry
  // job type validation
  | JobTypeValidationErrorLogEntry;

/** Structured log function. Accepts typed log entries with level, type, message, and data. */
export type Log = (options: TypedLogEntry) => void;
