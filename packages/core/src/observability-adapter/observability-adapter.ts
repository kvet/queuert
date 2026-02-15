import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type JobBasicData, type JobChainData, type JobProcessingData } from "./log.js";

export type JobSpanInputData = {
  chainTypeName: string;
  jobTypeName: string;
  isChainStart: boolean;

  /** For continuation jobs: trace context of the origin job */
  originTraceContext?: unknown;
  /** For blocker chains: trace context of the job that will be blocked by this chain */
  rootChainTraceContext?: unknown;
};

export type JobSpanResult =
  | {
      status: "created";
      jobId: string;
      chainId: string;
      rootChainId: string | null;
      originId: string | null;
    }
  | {
      status: "deduplicated";
      jobId: string;
      chainId: string;
      rootChainId: string | null;
      existingTraceContext?: unknown;
    }
  | {
      status: "error";
      error: unknown;
    };

export type JobSpanHandle = {
  getTraceContext: () => unknown;
  end: (result: JobSpanResult) => void;
};

export type JobAttemptSpanInputData = {
  traceContext: unknown;
  chainId: string;
  chainTypeName: string;
  jobId: string;
  jobTypeName: string;
  attempt: number;
  workerId: string;
};

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

export type SpanHandle = {
  end: () => void;
};

export type JobAttemptSpanHandle = {
  getTraceContext: () => unknown;
  startPrepare: () => SpanHandle;
  startComplete: () => SpanHandle;
  end: (result: JobAttemptSpanResult) => void;
};

export type CompleteJobSpanInputData = {
  traceContext: unknown;
  chainId: string;
  chainTypeName: string;
  jobId: string;
  jobTypeName: string;
  continued?: { jobId: string; jobTypeName: string };
  chainCompleted: boolean;
};

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

  // tracing
  startJobSpan: (data: JobSpanInputData) => JobSpanHandle | undefined;
  startAttemptSpan: (data: JobAttemptSpanInputData) => JobAttemptSpanHandle | undefined;
  completeJobSpan: (data: CompleteJobSpanInputData) => void;
};
