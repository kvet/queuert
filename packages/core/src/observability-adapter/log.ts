import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateAdapter, type StateJob } from "../state-adapter/state-adapter.js";

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
  chainId: string;
  chainTypeName: string;
};
export type JobProcessingData = JobBasicData & { status: StateJob["status"]; attempt: number };
type JobCreatedLogEntry = LogEntry<
  "job_created",
  "info",
  "Job created",
  {
    input: unknown;
    blockers: JobChainData[];
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
type JobAttemptTakenByAnotherWorkerLogEntry = LogEntry<
  "job_attempt_taken_by_another_worker",
  "warn",
  "Job taken by another worker",
  { leasedBy: string; leasedUntil: Date } & JobProcessingData & WorkerBasicData
>;
type JobAttemptAlreadyCompletedLogEntry = LogEntry<
  "job_attempt_already_completed",
  "warn",
  "Job already completed by another worker",
  { completedBy: string | null } & JobProcessingData & WorkerBasicData
>;
type JobAttemptLeaseExpiredLogEntry = LogEntry<
  "job_attempt_lease_expired",
  "warn",
  "Job lease expired",
  { leasedBy: string; leasedUntil: Date } & JobProcessingData & WorkerBasicData
>;
type JobAttemptLeaseRenewedLogEntry = LogEntry<
  "job_attempt_lease_renewed",
  "info",
  "Job lease renewed",
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

export type JobChainData = {
  id: string;
  typeName: string;
};
type JobChainCreatedLogEntry = LogEntry<
  "job_chain_created",
  "info",
  "Job chain created",
  JobChainData & { input: unknown }
>;
type JobChainCompletedLogEntry = LogEntry<
  "job_chain_completed",
  "info",
  "Job chain completed",
  { output: unknown } & JobChainData
>;

type JobBlockedLogEntry = LogEntry<
  "job_blocked",
  "info",
  "Job blocked by incomplete chains",
  { blockedByChains: JobChainData[] } & JobBasicData
>;
type JobUnblockedLogEntry = LogEntry<
  "job_unblocked",
  "info",
  "Job unblocked",
  { unblockedByChain: JobChainData } & JobBasicData
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
  | JobAttemptLeaseExpiredLogEntry
  | JobAttemptLeaseRenewedLogEntry
  | JobReapedLogEntry
  | JobAttemptFailedLogEntry
  | JobAttemptCompletedLogEntry
  | JobCompletedLogEntry
  // job chain
  | JobChainCreatedLogEntry
  | JobChainCompletedLogEntry
  // blockers
  | JobBlockedLogEntry
  | JobUnblockedLogEntry
  // notify adapter
  | NotifyContextAbsenceLogEntry
  | NotifyAdapterErrorLogEntry
  // state adapter
  | StateAdapterErrorLogEntry
  // job type validation
  | JobTypeValidationErrorLogEntry;

export type Log = (options: TypedLogEntry) => void;
