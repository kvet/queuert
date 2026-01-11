import { JobBasicData, JobProcessingData, JobSequenceData } from "./log.js";
import { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { StateAdapter } from "../state-adapter/state-adapter.js";

/**
 * Low-level adapter interface for observability metrics.
 *
 * Accepts primitive data types (not domain objects).
 * Use with ObservabilityHelper for domain-object-friendly interface.
 *
 * Counters only for now - histograms, gauges, and tracing will be added later.
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
      blockers: JobSequenceData[];
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

  // job sequence
  jobSequenceCreated: (data: JobSequenceData & { input: unknown }) => void;
  jobSequenceCompleted: (data: JobSequenceData & { output: unknown }) => void;

  // blockers
  jobBlocked: (data: JobBasicData & { blockedBySequences: JobSequenceData[] }) => void;
  jobUnblocked: (data: JobBasicData & { unblockedBySequence: JobSequenceData }) => void;

  // notify adapter
  notifyContextAbsence: (data: JobBasicData) => void;
  notifyAdapterError: (data: { operation: keyof NotifyAdapter; error: unknown }) => void;

  // state adapter
  stateAdapterError: (data: {
    operation: keyof StateAdapter<any, any, any>;
    error: unknown;
  }) => void;
};
