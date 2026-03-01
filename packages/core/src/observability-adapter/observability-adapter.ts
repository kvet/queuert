import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type JobBasicData, type JobChainData, type JobProcessingData } from "./log.js";

/** Input data for creating a job span. */
export type JobSpanInputData = {
  chainTypeName: string;
  jobTypeName: string;
  isChainStart: boolean;

  /** For continuation jobs: chain trace context of the origin job */
  originChainTraceContext?: unknown;
  /** For continuation jobs: job trace context of the origin job */
  originTraceContext?: unknown;
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
      existingChainTraceContext?: unknown;
    }
  | {
      status: "error";
      error: unknown;
    };

/** Handle for managing a job span's lifecycle and trace context. */
export type JobSpanHandle = {
  getChainTraceContext: () => unknown;
  getTraceContext: () => unknown;
  end: (result: JobSpanResult) => void;
};

/** Input data for creating a job attempt span. */
export type JobAttemptSpanInputData = {
  chainTraceContext: unknown;
  traceContext: unknown;
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
      continued?: { jobId: string; jobTypeName: string };
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
  getChainTraceContext: () => unknown;
  getTraceContext: () => unknown;
  startPrepare: () => SpanHandle;
  startComplete: () => SpanHandle;
  end: (result: JobAttemptSpanResult) => void;
};

/** Input data for completing a job span after all attempts. */
export type CompleteJobSpanInputData = {
  chainTraceContext: unknown;
  traceContext: unknown;
  chainId: string;
  chainTypeName: string;
  jobId: string;
  jobTypeName: string;
  continued?: { jobId: string; jobTypeName: string };
  chainCompleted: boolean;
};

/** Input data for creating a blocker dependency span. */
export type BlockerSpanInputData = {
  chainId: string;
  chainTypeName: string;
  jobId: string;
  jobTypeName: string;
  jobTraceContext: unknown;
  blockerChainId: string;
  blockerChainTypeName: string;
  blockerIndex: number;
};

/** Handle for managing a blocker dependency span. */
export type BlockerSpanHandle = {
  getTraceContext: () => unknown;
  end: (data?: { blockerChainTraceContext?: unknown }) => void;
};

/** Data for completing a blocker span when the blocker chain completes. */
export type CompleteBlockerSpanData = {
  traceContext: unknown;
  blockerChainTypeName: string;
};

/** Adapter for structured logging, metrics, and distributed tracing. All methods are synchronous — side effects are buffered via transaction hooks and flushed after commit. */
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

  // tracing
  startJobSpan: (data: JobSpanInputData) => JobSpanHandle | undefined;
  startBlockerSpan: (data: BlockerSpanInputData) => BlockerSpanHandle | undefined;
  completeBlockerSpan: (data: CompleteBlockerSpanData) => void;
  startAttemptSpan: (data: JobAttemptSpanInputData) => JobAttemptSpanHandle | undefined;
  completeJobSpan: (data: CompleteJobSpanInputData) => void;
};
