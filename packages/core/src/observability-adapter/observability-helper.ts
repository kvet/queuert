import type { Mode } from "@queuert/sync-async";

import type { JobTypeValidationError } from "../errors.ts";
import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import type {
  StateAdapter,
  StateChainInfo,
  StateJob,
  StateJobInfo,
} from "../state-adapter/state-adapter.ts";
import type {
  ChainBasicData,
  JobAttemptData,
  JobBasicData,
  JobCompletionData,
  JobProcessingData,
  JobRescheduleData,
  Log,
} from "./log.ts";
import type {
  BlockerSpanHandle,
  JobAttemptSpanHandle,
  JobAttemptSpanResult,
  JobSpanHandle,
  ObservabilityAdapter,
} from "./observability-adapter.ts";

export const completedAttemptSpanResult = (
  written: StateJob & { continuation?: StateJobInfo },
): JobAttemptSpanResult => ({
  status: "completed",
  continuedWith: written.continuation
    ? { jobId: written.continuation.id, jobTypeName: written.continuation.typeName }
    : undefined,
  chainCompleted:
    written.completedAt !== null && written.continuedToId === null
      ? { output: written.output }
      : undefined,
  rescheduled:
    written.completedAt === null
      ? { reason: written.lastRescheduleReason ?? undefined }
      : undefined,
});

const mapStateJobToJobBasicData = (stateJob: StateJob): JobBasicData => ({
  id: stateJob.id,
  typeName: stateJob.typeName,
  chainId: stateJob.chain.id,
  chainTypeName: stateJob.chain.typeName,
});

const mapStateJobToJobProcessingData = (stateJob: StateJob): JobProcessingData => ({
  ...mapStateJobToJobBasicData(stateJob),
  status: stateJob.status,
  attempt: stateJob.attempt,
});

const mapStateJobToJobAttemptData = (stateJob: StateJob): JobAttemptData => ({
  ...mapStateJobToJobProcessingData(stateJob),
  attemptAt: stateJob.attemptAt!,
  attemptBy: stateJob.attemptBy!,
});

const mapStateJobToJobCompletionData = (
  stateJob: StateJob,
  options: { output?: unknown; continuedWith?: StateJobInfo },
): JobCompletionData => ({
  ...mapStateJobToJobProcessingData(stateJob),
  output: options.output,
  continuedWith: options.continuedWith
    ? // A continuation always belongs to the chain it continues.
      mapStateJobToJobBasicData({ ...options.continuedWith, chain: stateJob.chain })
    : undefined,
});

const mapStateChainToChainData = (stateChain: {
  id: string;
  typeName: string;
}): ChainBasicData => ({
  id: stateChain.id,
  typeName: stateChain.typeName,
});

/**
 * High-level helper that wraps both Log and ObservabilityAdapter.
 *
 * Accepts domain objects (StateJob, Job, Chain) and emits to both
 * logging and metrics on each event. This ensures consistency between
 * logs and metrics.
 */
export type ObservabilityHelper = {
  // worker
  workerStarted: (options: { workerId: string; jobTypeNames: string[] }) => void;
  workerError: (options: { workerId: string }, error: unknown) => void;
  workerLeaseLost: (options: { workerId: string }) => void;
  workerStopped: (options: { workerId: string }) => void;

  // chain
  chainCreated: (stateChain: StateChainInfo, options: { input: unknown }) => void;
  chainCompleted: (stateChain: StateChainInfo, options: { output: unknown }) => void;
  chainDeleted: (stateChain: StateChainInfo) => void;

  // job
  jobCreated: (
    stateJob: StateJob,
    options: {
      blockers: StateChainInfo[];
    },
  ) => void;
  jobCompleted: (
    stateJob: StateJob,
    options: { output: unknown; continuedWith?: StateJobInfo },
  ) => void;
  jobRescheduled: (stateJob: StateJob) => void;
  jobBlocked: (stateJob: StateJob, options: { blockedByChains: StateChainInfo[] }) => void;
  jobUnblocked: (stateJob: StateJob, options: { unblockedByChain: StateChainInfo }) => void;

  // job attempt
  jobAttemptStarted: (
    stateJob: StateJob,
    options: { workerId: string; workerSlot: number },
  ) => JobAttemptSpanHandle | undefined;
  jobAttemptReclaimed: (
    stateJob: StateJob,
    options: { workerId: string; reclaimedFrom: string },
  ) => void;
  jobAttemptsFailed: (
    failures: {
      stateJob: StateJob;
      span: JobAttemptSpanHandle | undefined;
      rescheduledJob: StateJob | undefined;
    }[],
    options: { workerId: string; workerSlot: number; error: unknown },
  ) => void;
  jobAttemptsSettled: (
    settlements: {
      stateJob: StateJob;
      span: JobAttemptSpanHandle | undefined;
      written: StateJob & { continuation?: StateJobInfo };
      failure: { error: unknown } | undefined;
    }[],
    options: { durationMs: number; workerId: string; workerSlot: number },
  ) => void;

  // notify adapter
  notifyAdapterError: (operation: keyof NotifyAdapter<Mode>, error: unknown) => void;

  // state adapter
  stateAdapterError: (operation: keyof StateAdapter<any, any, any, Mode>, error: unknown) => void;

  // job type validation
  jobTypeValidationError: (error: JobTypeValidationError) => void;

  // histograms
  jobAttemptDuration: (
    stateJobs: readonly StateJob[],
    options: { durationMs: number; workerId: string },
  ) => void;
  jobAttemptBatchSize: (
    stateJobs: readonly Pick<StateJobInfo, "typeName">[],
    workerId: string,
  ) => void;

  // gauges
  jobTypeIdleChange: (delta: number, workerId: string, typeNames: readonly string[]) => void;
  jobTypeProcessingChange: (
    delta: number,
    stateJobs: readonly Pick<StateJobInfo, "typeName">[],
    workerId: string,
  ) => void;

  // tracing
  startJobSpan: (typeName: string, fromJob: StateJob | null) => JobSpanHandle | undefined;
  startAttemptSpan: (
    stateJob: StateJob,
    options: { workerId: string; workerSlot: number } | { workerId: null; workerSlot: null },
  ) => JobAttemptSpanHandle | undefined;
  startBlockerSpan: (
    stateJob: StateJob,
    options: { jobTraceContext: string; blockerChain: StateChainInfo; blockerIndex: number },
  ) => BlockerSpanHandle | undefined;
  completeBlockerSpan: (traceContext: string, blockerChain: StateChainInfo) => void;
};

const reportJobRescheduled = (log: Log, adapter: ObservabilityAdapter, stateJob: StateJob) => {
  const data: JobRescheduleData = {
    ...mapStateJobToJobBasicData(stateJob),
    scheduledAt: stateJob.scheduledAt,
    consecutiveFailures: stateJob.consecutiveFailures,
    ...(stateJob.lastRescheduleReason !== null && { reason: stateJob.lastRescheduleReason }),
  };
  log({
    type: "job_rescheduled",
    level: "info",
    message: "Job rescheduled",
    data,
  });
  adapter.jobRescheduled(data);
};

const reportJobAttemptFailed = (
  log: Log,
  adapter: ObservabilityAdapter,
  stateJob: StateJob,
  options: { workerId: string; workerSlot: number; error: unknown },
) => {
  const data = {
    ...mapStateJobToJobProcessingData(stateJob),
    workerId: options.workerId,
    workerSlot: options.workerSlot,
  };
  log({
    type: "job_attempt_failed",
    level: "error",
    message: "Job attempt failed",
    data,
    error: options.error,
  });
  adapter.jobAttemptFailed({ ...data, error: options.error });
};

const reportJobAttemptDuration = (
  adapter: ObservabilityAdapter,
  stateJob: StateJob,
  options: { durationMs: number; workerId: string },
) => {
  adapter.jobAttemptDuration({
    ...mapStateJobToJobProcessingData(stateJob),
    durationMs: options.durationMs,
    workerId: options.workerId,
  });
};

const startAttemptSpan = (
  adapter: ObservabilityAdapter,
  stateJob: StateJob,
  {
    workerId,
    workerSlot,
  }: { workerId: string; workerSlot: number } | { workerId: null; workerSlot: null },
): JobAttemptSpanHandle | undefined => {
  try {
    return adapter.startAttemptSpan({
      chainId: stateJob.chain.id,
      chainTypeName: stateJob.chain.typeName,
      jobId: stateJob.id,
      jobTypeName: stateJob.typeName,
      attempt: stateJob.attempt,
      workerId,
      workerSlot,
      chainTraceContext: stateJob.chain.traceContext,
      traceContext: stateJob.traceContext,
    });
  } catch {
    return undefined;
  }
};

const noopLog: Log = () => {};

export const createObservabilityHelper = ({
  log = noopLog,
  adapter,
}: {
  log?: Log;
  adapter: ObservabilityAdapter;
}): ObservabilityHelper => ({
  // worker
  workerStarted(options) {
    log({
      type: "worker_started",
      level: "info",
      message: "Started worker",
      data: options,
    });
    adapter.workerStarted(options);
  },
  workerError(options, error) {
    log({
      type: "worker_error",
      level: "error",
      message: "Worker error",
      data: options,
      error,
    });
    adapter.workerError({ ...options, error });
  },
  workerLeaseLost(options) {
    log({
      type: "worker_lease_lost",
      level: "warn",
      message: "Worker lost its lease",
      data: options,
    });
    adapter.workerLeaseLost(options);
  },
  workerStopped(options) {
    log({
      type: "worker_stopped",
      level: "info",
      message: "Worker has been stopped",
      data: options,
    });
    adapter.workerStopped(options);
  },

  // chain
  chainCreated(stateChain, options) {
    const data = { ...mapStateChainToChainData(stateChain), input: options.input };
    log({
      type: "chain_created",
      level: "info",
      message: "Chain created",
      data,
    });
    adapter.chainCreated(data);
  },
  chainCompleted(stateChain, options) {
    const data = { ...mapStateChainToChainData(stateChain), output: options.output };
    log({
      type: "chain_completed",
      level: "info",
      message: "Chain completed",
      data,
    });
    adapter.chainCompleted(data);
    if (stateChain.completedAt) {
      const durationMs = stateChain.completedAt.getTime() - stateChain.createdAt.getTime();
      adapter.chainDuration({ ...mapStateChainToChainData(stateChain), durationMs });
    }
  },
  chainDeleted(stateChain) {
    const data = mapStateChainToChainData(stateChain);
    log({
      type: "chain_deleted",
      level: "info",
      message: "Chain deleted",
      data,
    });
    adapter.chainDeleted(data);
  },

  // job
  jobCreated(stateJob, options) {
    const data = {
      ...mapStateJobToJobBasicData(stateJob),
      input: stateJob.input,
      blockers: options.blockers.map(mapStateChainToChainData),
      scheduledAt: stateJob.scheduledAt,
    };

    log({
      type: "job_created",
      level: "info",
      message: "Job created",
      data,
    });
    adapter.jobCreated(data);
  },
  jobCompleted(stateJob, options) {
    const data = mapStateJobToJobCompletionData(stateJob, options);

    log({
      type: "job_completed",
      level: "info",
      message: "Job completed",
      data,
    });
    adapter.jobCompleted(data);
    if (stateJob.completedAt) {
      const durationMs = stateJob.completedAt.getTime() - stateJob.createdAt.getTime();
      adapter.jobDuration({ ...mapStateJobToJobProcessingData(stateJob), durationMs });
    }
  },
  jobRescheduled(stateJob) {
    reportJobRescheduled(log, adapter, stateJob);
  },
  jobBlocked(stateJob, options) {
    const blockedByChains = options.blockedByChains.map(mapStateChainToChainData);
    const data = { ...mapStateJobToJobBasicData(stateJob), blockedByChains };
    log({
      type: "job_blocked",
      level: "info",
      message: "Job blocked by incomplete chains",
      data,
    });
    adapter.jobBlocked(data);
  },
  jobUnblocked(stateJob, options) {
    const data = {
      ...mapStateJobToJobBasicData(stateJob),
      unblockedByChain: mapStateChainToChainData(options.unblockedByChain),
    };
    log({
      type: "job_unblocked",
      level: "info",
      message: "Job unblocked",
      data,
    });
    adapter.jobUnblocked(data);
  },

  // job attempt
  jobAttemptStarted(stateJob, options) {
    const data = {
      ...mapStateJobToJobProcessingData(stateJob),
      workerId: options.workerId,
      workerSlot: options.workerSlot,
    };
    log({
      type: "job_attempt_started",
      level: "info",
      message: "Job attempt started",
      data,
    });
    adapter.jobAttemptStarted(data);
    return startAttemptSpan(adapter, stateJob, options);
  },
  jobAttemptReclaimed(stateJob, options) {
    const data = {
      ...mapStateJobToJobAttemptData(stateJob),
      workerId: options.workerId,
      reclaimedFrom: options.reclaimedFrom,
    };
    log({
      type: "job_attempt_reclaimed",
      level: "info",
      message: "Reclaimed job attempt",
      data,
    });
    adapter.jobAttemptReclaimed(data);
  },
  jobAttemptsFailed(failures, { workerId, workerSlot, error }) {
    for (const { stateJob, span, rescheduledJob } of failures) {
      if (rescheduledJob === undefined) {
        const data = { ...mapStateJobToJobAttemptData(stateJob), workerId, workerSlot };
        log({
          type: "job_attempt_lost",
          level: "warn",
          message: "Job attempt lost",
          data,
        });
        adapter.jobAttemptLost(data);
      } else {
        reportJobRescheduled(log, adapter, rescheduledJob);
        reportJobAttemptFailed(log, adapter, stateJob, { workerId, workerSlot, error });
      }
      span?.end({ status: "failed", error });
    }
  },
  jobAttemptsSettled(settlements, { durationMs, workerId, workerSlot }) {
    for (const { stateJob, span, written, failure } of settlements) {
      reportJobAttemptDuration(adapter, stateJob, { durationMs, workerId });
      if (failure !== undefined) {
        reportJobAttemptFailed(log, adapter, stateJob, {
          workerId,
          workerSlot,
          error: failure.error,
        });
        span?.end({ status: "failed", error: failure.error });
        continue;
      }
      const data = {
        ...mapStateJobToJobCompletionData(stateJob, {
          output: written.output,
          continuedWith: written.continuation,
        }),
        workerId,
        workerSlot,
      };
      log({
        type: "job_attempt_completed",
        level: "info",
        message: "Job attempt completed",
        data,
      });
      adapter.jobAttemptCompleted(data);
      span?.end(completedAttemptSpanResult(written));
    }
  },

  // notify adapter
  notifyAdapterError(operation, error) {
    log({
      type: "notify_adapter_error",
      level: "warn",
      message: "Notify adapter error",
      data: { operation },
      error,
    });
    adapter.notifyAdapterError({ operation, error });
  },

  // state adapter
  stateAdapterError(operation, error) {
    log({
      type: "state_adapter_error",
      level: "warn",
      message: "State adapter error",
      data: { operation },
      error,
    });
    adapter.stateAdapterError({ operation, error });
  },

  // job type validation
  jobTypeValidationError(error) {
    log({
      type: "job_type_validation_error",
      level: "error",
      message: error.message,
      data: {
        code: error.code,
        typeName: error.typeName,
        ...error.details,
      },
      error,
    });
  },

  // histograms
  jobAttemptDuration(stateJobs, options) {
    for (const stateJob of stateJobs) {
      reportJobAttemptDuration(adapter, stateJob, options);
    }
  },
  jobAttemptBatchSize(stateJobs, workerId) {
    adapter.jobAttemptBatchSize({
      typeName: stateJobs[0].typeName,
      workerId,
      size: stateJobs.length,
    });
  },

  // gauges
  jobTypeIdleChange(delta, workerId, typeNames) {
    for (const typeName of typeNames) {
      adapter.jobTypeIdleChange({ delta, typeName, workerId });
    }
  },
  jobTypeProcessingChange(delta, stateJobs, workerId) {
    for (const stateJob of stateJobs) {
      adapter.jobTypeProcessingChange({
        delta,
        typeName: stateJob.typeName,
        workerId,
      });
    }
  },

  // tracing
  startJobSpan: (typeName, fromJob) => {
    try {
      return adapter.startJobSpan(
        fromJob === null
          ? { chainTypeName: typeName, jobTypeName: typeName, isChainHead: true }
          : {
              chainTypeName: fromJob.chain.typeName,
              jobTypeName: typeName,
              isChainHead: false,
              originChainTraceContext: fromJob.chain.traceContext,
              originTraceContext: fromJob.traceContext,
            },
      );
    } catch {
      return undefined;
    }
  },
  startBlockerSpan: (stateJob, { jobTraceContext, blockerChain, blockerIndex }) => {
    try {
      return adapter.startBlockerSpan({
        chainId: stateJob.chain.id,
        chainTypeName: stateJob.chain.typeName,
        jobId: stateJob.id,
        jobTypeName: stateJob.typeName,
        jobTraceContext,
        blockerChainId: blockerChain.id,
        blockerChainTypeName: blockerChain.typeName,
        blockerIndex,
      });
    } catch {
      return undefined;
    }
  },
  completeBlockerSpan: (traceContext, blockerChain) => {
    try {
      adapter.completeBlockerSpan({ traceContext, blockerChainTypeName: blockerChain.typeName });
    } catch {}
  },
  startAttemptSpan: (stateJob, options) => startAttemptSpan(adapter, stateJob, options),
});
