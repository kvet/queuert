import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type JobAbortReason } from "../worker/job-process.js";
import {
  type JobAttemptData,
  type JobBasicData,
  type ChainData,
  type JobCompletionData,
  type JobProcessingData,
  type WorkerBasicData,
} from "./log.js";

/** Input data for creating a job span. */
export type JobSpanInputData = {
  chainTypeName: string;
  jobTypeName: string;
  isChainStart: boolean;

  /** For continuation jobs: chain trace context of the origin job */
  originChainTraceContext?: string | null;
  /** For continuation jobs: job trace context of the origin job */
  originTraceContext?: string | null;
};

/** Result of a job span — created, deduplicated, or error. */
export type JobSpanResult =
  | {
      status: "created";
      jobId: string;
      chainId: string;
    }
  | {
      status: "deduplicated";
      jobId: string;
      chainId: string;
      existingChainTraceContext?: string | null;
    }
  | {
      status: "error";
      error: unknown;
    };

/** Handle for managing a job span's lifecycle and trace context. */
export type JobSpanHandle = {
  getChainTraceContext: () => string;
  getTraceContext: () => string;
  end: (result: JobSpanResult) => void;
};

/** Input data for creating a job attempt span. */
export type JobAttemptSpanInputData = {
  chainTraceContext: string | null;
  traceContext: string | null;
  chainId: string;
  chainTypeName: string;
  jobId: string;
  jobTypeName: string;
  attempt: number;
  workerId: string;
};

/** Result of a job attempt span — completed or failed. */
export type JobAttemptSpanResult =
  | {
      status: "completed";
      continuedWith?: { jobId: string; jobTypeName: string };
      chainCompleted?: { output: unknown };
    }
  | {
      status: "failed";
      error: unknown;
      rescheduledAt?: Date;
      rescheduledAfterMs?: number;
    };

/** Handle for ending a span. */
export type SpanHandle = {
  end: () => void;
};

/** Handle for managing a job attempt span, including prepare/complete sub-spans. */
export type JobAttemptSpanHandle = {
  getChainTraceContext: () => string;
  getTraceContext: () => string;
  startPrepare: () => SpanHandle;
  startExecute: () => SpanHandle;
  startComplete: () => SpanHandle;
  recordAbort: (reason: JobAbortReason) => void;
  end: (result: JobAttemptSpanResult) => void;
};

/** Input data for completing a job span after all attempts. */
export type CompleteJobSpanInputData = {
  chainTraceContext: string | null;
  traceContext: string | null;
  chainId: string;
  chainTypeName: string;
  jobId: string;
  jobTypeName: string;
  continuedWith?: { jobId: string; jobTypeName: string };
  chainCompleted: boolean;
};

/** Input data for creating a blocker dependency span. */
export type BlockerSpanInputData = {
  chainId: string;
  chainTypeName: string;
  jobId: string;
  jobTypeName: string;
  jobTraceContext: string;
  blockerChainId: string;
  blockerChainTypeName: string;
  blockerIndex: number;
};

/** Handle for managing a blocker dependency span. */
export type BlockerSpanHandle = {
  getTraceContext: () => string;
  end: (data: { blockerChainTraceContext: string | null }) => void;
};

/** Data for completing a blocker span when the blocker chain completes. */
export type CompleteBlockerSpanData = {
  traceContext: string | null;
  blockerChainTypeName: string;
};

/**
 * Adapter for structured logging, metrics, and distributed tracing. All methods
 * are synchronous — side effects are buffered via transaction hooks and flushed
 * after commit.
 */
export type ObservabilityAdapter = {
  // worker
  workerStarted: (data: WorkerBasicData & { jobTypeNames: string[] }) => void;
  workerError: (data: WorkerBasicData & { error: unknown }) => void;
  workerStopping: (data: WorkerBasicData) => void;
  workerStopped: (data: WorkerBasicData) => void;

  // job
  jobCreated: (
    data: JobBasicData & {
      input: unknown;
      blockers: ChainData[];
      scheduledAt: Date;
    },
  ) => void;
  jobAttemptStarted: (data: JobProcessingData & WorkerBasicData) => void;
  jobAttemptTakenByAnotherWorker: (data: JobAttemptData & WorkerBasicData) => void;
  jobAttemptAlreadyCompleted: (
    data: JobProcessingData & WorkerBasicData & { completedBy: string | null },
  ) => void;
  jobAttemptExpired: (data: JobAttemptData & WorkerBasicData) => void;
  jobAttemptExtended: (data: JobAttemptData & WorkerBasicData) => void;
  jobAttemptFailed: (data: JobProcessingData & WorkerBasicData & { error: unknown }) => void;
  jobAttemptCompleted: (data: JobCompletionData & WorkerBasicData) => void;
  jobCompleted: (data: JobCompletionData & { workerId: string | null }) => void;
  jobAttemptReclaimed: (data: JobAttemptData & WorkerBasicData) => void;

  // chain
  chainCreated: (data: ChainData & { input: unknown }) => void;
  chainCompleted: (data: ChainData & { output: unknown }) => void;
  chainDeleted: (data: ChainData) => void;

  // reschedule
  jobRescheduled: (data: JobBasicData & { scheduledAt: Date }) => void;

  // blockers
  jobBlocked: (data: JobBasicData & { blockedByChains: ChainData[] }) => void;
  jobUnblocked: (data: JobBasicData & { unblockedByChain: ChainData }) => void;

  // notify adapter
  notifyAdapterError: (data: { operation: keyof NotifyAdapter; error: unknown }) => void;

  // state adapter
  stateAdapterError: (data: { operation: keyof StateAdapter<any, any>; error: unknown }) => void;

  // histograms
  chainDuration: (data: ChainData & { durationMs: number }) => void;
  jobDuration: (data: JobProcessingData & { durationMs: number }) => void;
  jobAttemptDuration: (data: JobProcessingData & WorkerBasicData & { durationMs: number }) => void;

  // gauges (UpDownCounters)
  jobTypeIdleChange: (data: WorkerBasicData & { delta: number; typeName: string }) => void;
  jobTypeProcessingChange: (data: WorkerBasicData & { delta: number; typeName: string }) => void;

  // tracing
  startJobSpan: (data: JobSpanInputData) => JobSpanHandle | undefined;
  startBlockerSpan: (data: BlockerSpanInputData) => BlockerSpanHandle | undefined;
  completeBlockerSpan: (data: CompleteBlockerSpanData) => void;
  startAttemptSpan: (data: JobAttemptSpanInputData) => JobAttemptSpanHandle | undefined;
  completeJobSpan: (data: CompleteJobSpanInputData) => void;
};
