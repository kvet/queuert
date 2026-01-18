import { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { StateAdapter } from "../state-adapter/state-adapter.js";
import { JobBasicData, JobProcessingData, JobChainData } from "./log.js";

/**
 * Low-level adapter interface for observability metrics.
 *
 * Accepts primitive data types (not domain objects).
 * Use with ObservabilityHelper for domain-object-friendly interface.
 */
export type ObservabilityAdapter = {
  // worker
  workerStarted: (data: { workerId: string; jobTypeNames: string[] }) => void;
  workerError: (data: { workerId: string; error: unknown }) => void;
  workerStopping: (data: { workerId: string }) => void;
  workerStopped: (data: { workerId: string }) => void;

  // job
  jobCreated: (
    data: JobBasicData & {
      input: unknown;
      blockers: JobChainData[];
      scheduledAt?: Date;
      scheduleAfterMs?: number;
    },
  ) => void;
  jobAttemptStarted: (data: JobProcessingData & { workerId: string }) => void;
  jobAttemptTakenByAnotherWorker: (
    data: JobProcessingData & { workerId: string; leasedBy: string; leasedUntil: Date },
  ) => void;
  jobAttemptAlreadyCompleted: (
    data: JobProcessingData & { workerId: string; completedBy: string | null },
  ) => void;
  jobAttemptLeaseExpired: (
    data: JobProcessingData & { workerId: string; leasedBy: string; leasedUntil: Date },
  ) => void;
  jobAttemptLeaseRenewed: (
    data: JobProcessingData & { workerId: string; leasedBy: string; leasedUntil: Date },
  ) => void;
  jobAttemptFailed: (
    data: JobProcessingData & {
      workerId: string;
      rescheduledAt?: Date;
      rescheduledAfterMs?: number;
      error: unknown;
    },
  ) => void;
  jobAttemptCompleted: (
    data: JobProcessingData & {
      output: unknown;
      continuedWith?: JobBasicData;
      workerId: string;
    },
  ) => void;
  jobCompleted: (
    data: JobProcessingData & {
      output: unknown;
      continuedWith?: JobBasicData;
      workerId: string | null;
    },
  ) => void;
  jobReaped: (
    data: JobBasicData & { leasedBy: string; leasedUntil: Date; workerId: string },
  ) => void;

  // job chain
  jobChainCreated: (data: JobChainData & { input: unknown }) => void;
  jobChainCompleted: (data: JobChainData & { output: unknown }) => void;

  // blockers
  jobBlocked: (data: JobBasicData & { blockedByChains: JobChainData[] }) => void;
  jobUnblocked: (data: JobBasicData & { unblockedByChain: JobChainData }) => void;

  // notify adapter
  notifyContextAbsence: (data: JobBasicData) => void;
  notifyAdapterError: (data: { operation: keyof NotifyAdapter; error: unknown }) => void;

  // state adapter
  stateAdapterError: (data: { operation: keyof StateAdapter<any, any>; error: unknown }) => void;

  // histograms
  jobChainDuration: (data: JobChainData & { durationMs: number }) => void;
  jobDuration: (data: JobProcessingData & { durationMs: number }) => void;
  jobAttemptDuration: (data: JobProcessingData & { durationMs: number; workerId: string }) => void;

  // gauges (UpDownCounters)
  jobTypeIdleChange: (data: { delta: number; typeName: string; workerId: string }) => void;
  jobTypeProcessingChange: (data: { delta: number; typeName: string; workerId: string }) => void;
};
