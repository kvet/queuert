import { type AnyChain } from "../entities/chain.js";
import { deriveStatus } from "../entities/job.js";
import { type JobTypeValidationError } from "../errors.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateAdapter, type StateJob } from "../state-adapter/state-adapter.js";
import {
  type ChainBasicData,
  type JobAttemptData,
  type JobBasicData,
  type JobCompletionData,
  type JobProcessingData,
  type Log,
} from "./log.js";
import {
  type BlockerSpanHandle,
  type BlockerSpanInputData,
  type CompleteBlockerSpanData,
  type JobAttemptSpanHandle,
  type JobAttemptSpanInputData,
  type JobSpanHandle,
  type JobSpanInputData,
  type ObservabilityAdapter,
} from "./observability-adapter.js";

const mapStateJobToJobBasicData = (job: StateJob): JobBasicData => ({
  id: job.id,
  typeName: job.typeName,
  chainId: job.chainId,
  chainTypeName: job.chainTypeName,
});

const mapStateJobToJobProcessingData = (job: StateJob): JobProcessingData => ({
  ...mapStateJobToJobBasicData(job),
  status: deriveStatus(job),
  attempt: job.attempt,
});

const mapStateJobToJobAttemptData = (job: StateJob): JobAttemptData => ({
  ...mapStateJobToJobProcessingData(job),
  attemptAt: job.attemptAt!,
  attemptBy: job.attemptBy!,
  attemptUntil: job.attemptUntil!,
});

const mapStateJobToJobCompletionData = (
  job: StateJob,
  options: { output?: unknown; continuedWith?: StateJob },
): JobCompletionData => ({
  ...mapStateJobToJobProcessingData(job),
  output: options.output,
  continuedWith: options.continuedWith
    ? mapStateJobToJobBasicData(options.continuedWith)
    : undefined,
});

const mapStateJobToChainData = (job: StateJob): ChainBasicData => ({
  id: job.chainId,
  typeName: job.chainTypeName,
});

const mapChainToData = (chain: AnyChain): ChainBasicData => ({
  id: chain.id,
  typeName: chain.typeName,
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
  workerStopping: (options: { workerId: string }) => void;
  workerStopped: (options: { workerId: string }) => void;

  // chain
  chainCreated: (job: StateJob, options: { input: unknown }) => void;
  chainCompleted: (headJob: StateJob, options: { output: unknown }) => void;
  chainDeleted: (job: StateJob) => void;

  // job
  jobCreated: (
    job: StateJob,
    options: {
      input: unknown;
      blockers: AnyChain[];
    },
  ) => void;
  jobCompleted: (job: StateJob, options: { output: unknown; continuedWith?: StateJob }) => void;
  jobRescheduled: (job: StateJob) => void;
  jobBlocked: (job: StateJob, options: { blockedByChains: AnyChain[] }) => void;
  jobUnblocked: (job: StateJob, options: { unblockedByChain: StateJob }) => void;

  // job attempt
  jobAttemptStarted: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptTakenByAnotherWorker: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptAlreadyCompleted: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptExpired: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptExtended: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptFailed: (job: StateJob, options: { workerId: string; error: unknown }) => void;
  jobAttemptCompleted: (
    job: StateJob,
    options: { output?: unknown; continuedWith?: StateJob; workerId: string },
  ) => void;
  jobAttemptReclaimed: (job: StateJob, options: { workerId: string }) => void;

  // notify adapter
  notifyAdapterError: (operation: keyof NotifyAdapter, error: unknown) => void;

  // state adapter
  stateAdapterError: (operation: keyof StateAdapter<any, any>, error: unknown) => void;

  // job type validation
  jobTypeValidationError: (error: JobTypeValidationError) => void;

  // histograms
  chainDuration: (headJob: StateJob, tailJob: StateJob) => void;
  jobDuration: (job: StateJob) => void;
  jobAttemptDuration: (job: StateJob, options: { durationMs: number; workerId: string }) => void;

  // gauges
  jobTypeIdleChange: (delta: number, workerId: string, typeNames: readonly string[]) => void;
  jobTypeProcessingChange: (delta: number, job: StateJob, workerId: string) => void;

  // tracing
  startJobSpan: (data: JobSpanInputData) => JobSpanHandle | undefined;
  startAttemptSpan: (data: JobAttemptSpanInputData) => JobAttemptSpanHandle | undefined;
  completeJobSpan: (
    job: StateJob,
    options: { continuedWith?: StateJob; chainCompleted: boolean },
  ) => void;
  startBlockerSpan: (data: BlockerSpanInputData) => BlockerSpanHandle | undefined;
  completeBlockerSpan: (data: CompleteBlockerSpanData) => void;
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
  workerStopping(options) {
    log({
      type: "worker_stopping",
      level: "info",
      message: "Stopping worker...",
      data: options,
    });
    adapter.workerStopping(options);
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
  chainCreated(job, options) {
    const data = { ...mapStateJobToChainData(job), input: options.input };
    log({
      type: "chain_created",
      level: "info",
      message: "Chain created",
      data,
    });
    adapter.chainCreated(data);
  },
  chainCompleted(headJob, options) {
    const data = { ...mapStateJobToChainData(headJob), output: options.output };
    log({
      type: "chain_completed",
      level: "info",
      message: "Chain completed",
      data,
    });
    adapter.chainCompleted(data);
  },
  chainDeleted(job) {
    const data = mapStateJobToChainData(job);
    log({
      type: "chain_deleted",
      level: "info",
      message: "Chain deleted",
      data,
    });
    adapter.chainDeleted(data);
  },

  // job
  jobCreated(job, options) {
    const data = {
      ...mapStateJobToJobBasicData(job),
      input: options.input,
      blockers: options.blockers.map(mapChainToData),
      scheduledAt: job.scheduledAt,
    };

    log({
      type: "job_created",
      level: "info",
      message: "Job created",
      data,
    });
    adapter.jobCreated(data);
  },
  jobCompleted(job, options) {
    const data = mapStateJobToJobCompletionData(job, options);

    log({
      type: "job_completed",
      level: "info",
      message: "Job completed",
      data,
    });
    adapter.jobCompleted(data);
  },
  jobRescheduled(job) {
    const data = {
      ...mapStateJobToJobBasicData(job),
      scheduledAt: job.scheduledAt,
    };
    log({
      type: "job_rescheduled",
      level: "info",
      message: "Job rescheduled",
      data,
    });
    adapter.jobRescheduled(data);
  },
  jobBlocked(job, options) {
    const blockedByChains = options.blockedByChains.map(mapChainToData);
    const data = { ...mapStateJobToJobBasicData(job), blockedByChains };
    log({
      type: "job_blocked",
      level: "info",
      message: "Job blocked by incomplete chains",
      data,
    });
    adapter.jobBlocked(data);
  },
  jobUnblocked(job, options) {
    const unblockedByChain = mapStateJobToChainData(options.unblockedByChain);
    log({
      type: "job_unblocked",
      level: "info",
      message: "Job unblocked",
      data: { ...mapStateJobToJobBasicData(job), unblockedByChain },
    });
    adapter.jobUnblocked({ ...mapStateJobToJobBasicData(job), unblockedByChain });
  },

  // job attempt
  jobAttemptStarted(job, options) {
    const data = { ...mapStateJobToJobProcessingData(job), workerId: options.workerId };
    log({
      type: "job_attempt_started",
      level: "info",
      message: "Job attempt started",
      data,
    });
    adapter.jobAttemptStarted(data);
  },
  jobAttemptTakenByAnotherWorker(job, options) {
    const data = {
      ...mapStateJobToJobAttemptData(job),
      workerId: options.workerId,
    };
    log({
      type: "job_attempt_taken_by_another_worker",
      level: "warn",
      message: "Job taken by another worker",
      data,
    });
    adapter.jobAttemptTakenByAnotherWorker(data);
  },
  jobAttemptAlreadyCompleted(job, options) {
    const data = {
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
      completedBy: job.completedBy,
    };
    log({
      type: "job_attempt_already_completed",
      level: "warn",
      message: "Job already completed by another worker",
      data,
    });
    adapter.jobAttemptAlreadyCompleted(data);
  },
  jobAttemptExpired(job, options) {
    const data = {
      ...mapStateJobToJobAttemptData(job),
      workerId: options.workerId,
    };
    log({
      type: "job_attempt_expired",
      level: "warn",
      message: "Job attempt expired",
      data,
    });
    adapter.jobAttemptExpired(data);
  },
  jobAttemptExtended(job, options) {
    const data = {
      ...mapStateJobToJobAttemptData(job),
      workerId: options.workerId,
    };
    log({
      type: "job_attempt_extended",
      level: "info",
      message: "Job attempt extended",
      data,
    });
    adapter.jobAttemptExtended(data);
  },
  jobAttemptReclaimed(job, options) {
    const data = {
      ...mapStateJobToJobAttemptData(job),
      workerId: options.workerId,
    };
    log({
      type: "job_attempt_reclaimed",
      level: "info",
      message: "Reclaimed expired job attempt",
      data,
    });
    adapter.jobAttemptReclaimed(data);
  },
  jobAttemptFailed(job, options) {
    const data = {
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
    };
    log({
      type: "job_attempt_failed",
      level: "error",
      message: "Job attempt failed",
      data,
      error: options.error,
    });
    adapter.jobAttemptFailed({ ...data, error: options.error });
  },
  jobAttemptCompleted(job, options) {
    const data = {
      ...mapStateJobToJobCompletionData(job, options),
      workerId: options.workerId,
    };
    log({
      type: "job_attempt_completed",
      level: "info",
      message: "Job attempt completed",
      data,
    });
    adapter.jobAttemptCompleted(data);
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
  chainDuration(headJob, tailJob) {
    if (tailJob.completedAt && headJob.createdAt) {
      const durationMs = tailJob.completedAt.getTime() - headJob.createdAt.getTime();
      adapter.chainDuration({ ...mapStateJobToChainData(headJob), durationMs });
    }
  },
  jobDuration(job) {
    if (job.completedAt && job.createdAt) {
      const durationMs = job.completedAt.getTime() - job.createdAt.getTime();
      adapter.jobDuration({ ...mapStateJobToJobProcessingData(job), durationMs });
    }
  },
  jobAttemptDuration(job, options) {
    adapter.jobAttemptDuration({
      ...mapStateJobToJobProcessingData(job),
      durationMs: options.durationMs,
      workerId: options.workerId,
    });
  },

  // gauges
  jobTypeIdleChange(delta, workerId, typeNames) {
    for (const typeName of typeNames) {
      adapter.jobTypeIdleChange({ delta, typeName, workerId });
    }
  },
  jobTypeProcessingChange(delta, job, workerId) {
    adapter.jobTypeProcessingChange({
      delta,
      typeName: job.typeName,
      workerId,
    });
  },

  // tracing
  startJobSpan: (data) => {
    try {
      return adapter.startJobSpan(data);
    } catch {
      return undefined;
    }
  },
  startBlockerSpan: (data) => {
    try {
      return adapter.startBlockerSpan(data);
    } catch {
      return undefined;
    }
  },
  completeBlockerSpan: (data) => {
    try {
      adapter.completeBlockerSpan(data);
    } catch {}
  },
  startAttemptSpan: (data) => {
    try {
      return adapter.startAttemptSpan(data);
    } catch {
      return undefined;
    }
  },
  completeJobSpan: (job, options) => {
    try {
      adapter.completeJobSpan({
        chainTraceContext: job.chainTraceContext,
        traceContext: job.traceContext,
        chainId: job.chainId,
        chainTypeName: job.chainTypeName,
        jobId: job.id,
        jobTypeName: job.typeName,
        continuedWith: options.continuedWith
          ? { jobId: options.continuedWith.id, jobTypeName: options.continuedWith.typeName }
          : undefined,
        chainCompleted: options.chainCompleted,
      });
    } catch {}
  },
});
