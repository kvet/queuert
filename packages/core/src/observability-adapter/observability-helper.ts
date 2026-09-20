import { type AnyChain } from "../entities/chain.js";
import { type JobTypeValidationError } from "../errors.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import {
  type StateAdapter,
  type StateChainInfo,
  type StateJob,
  type StateJobInfo,
} from "../state-adapter/state-adapter.js";
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
  attemptUntil: stateJob.attemptUntil!,
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

const mapChainToData = (chain: { id: string; typeName: string }): ChainBasicData => ({
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
  chainCreated: (chain: StateChainInfo, options: { input: unknown }) => void;
  chainCompleted: (chain: StateChainInfo, options: { output: unknown }) => void;
  chainDeleted: (chain: StateChainInfo) => void;

  // job
  jobCreated: (
    stateJob: StateJob,
    options: {
      input: unknown;
      blockers: AnyChain[];
    },
  ) => void;
  jobCompleted: (
    stateJob: StateJob,
    options: { output: unknown; continuedWith?: StateJobInfo },
  ) => void;
  jobRescheduled: (stateJob: StateJob) => void;
  jobBlocked: (stateJob: StateJob, options: { blockedByChains: AnyChain[] }) => void;
  jobUnblocked: (stateJob: StateJob, options: { unblockedByChain: StateChainInfo }) => void;

  // job attempt
  jobAttemptStarted: (stateJob: StateJob, options: { workerId: string }) => void;
  jobAttemptTakenByAnotherWorker: (stateJob: StateJob, options: { workerId: string }) => void;
  jobAttemptAlreadyCompleted: (stateJob: StateJob, options: { workerId: string }) => void;
  jobAttemptExpired: (stateJob: StateJob, options: { workerId: string }) => void;
  jobAttemptExtended: (stateJob: StateJob, options: { workerId: string }) => void;
  jobAttemptFailed: (stateJob: StateJob, options: { workerId: string; error: unknown }) => void;
  jobAttemptCompleted: (
    stateJob: StateJob,
    options: { output?: unknown; continuedWith?: StateJobInfo; workerId: string },
  ) => void;
  jobAttemptReclaimed: (stateJob: StateJob, options: { workerId: string }) => void;

  // notify adapter
  notifyAdapterError: (operation: keyof NotifyAdapter, error: unknown) => void;

  // state adapter
  stateAdapterError: (operation: keyof StateAdapter<any, any>, error: unknown) => void;

  // job type validation
  jobTypeValidationError: (error: JobTypeValidationError) => void;

  // histograms
  chainDuration: (chain: StateChainInfo) => void;
  jobDuration: (stateJob: StateJob) => void;
  jobAttemptDuration: (
    stateJob: StateJob,
    options: { durationMs: number; workerId: string },
  ) => void;

  // gauges
  jobTypeIdleChange: (delta: number, workerId: string, typeNames: readonly string[]) => void;
  jobTypeProcessingChange: (
    delta: number,
    job: Pick<StateJobInfo, "typeName">,
    workerId: string,
  ) => void;

  // tracing
  startJobSpan: (data: JobSpanInputData) => JobSpanHandle | undefined;
  startAttemptSpan: (data: JobAttemptSpanInputData) => JobAttemptSpanHandle | undefined;
  completeJobSpan: (
    stateJob: StateJob,
    options: { continuedWith?: StateJobInfo; chainCompleted: boolean },
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
  chainCreated(chain, options) {
    const data = { ...mapChainToData(chain), input: options.input };
    log({
      type: "chain_created",
      level: "info",
      message: "Chain created",
      data,
    });
    adapter.chainCreated(data);
  },
  chainCompleted(chain, options) {
    const data = { ...mapChainToData(chain), output: options.output };
    log({
      type: "chain_completed",
      level: "info",
      message: "Chain completed",
      data,
    });
    adapter.chainCompleted(data);
  },
  chainDeleted(chain) {
    const data = mapChainToData(chain);
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
      input: options.input,
      blockers: options.blockers.map(mapChainToData),
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
  },
  jobRescheduled(stateJob) {
    const data = {
      ...mapStateJobToJobBasicData(stateJob),
      scheduledAt: stateJob.scheduledAt,
    };
    log({
      type: "job_rescheduled",
      level: "info",
      message: "Job rescheduled",
      data,
    });
    adapter.jobRescheduled(data);
  },
  jobBlocked(stateJob, options) {
    const blockedByChains = options.blockedByChains.map(mapChainToData);
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
      unblockedByChain: mapChainToData(options.unblockedByChain),
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
    const data = { ...mapStateJobToJobProcessingData(stateJob), workerId: options.workerId };
    log({
      type: "job_attempt_started",
      level: "info",
      message: "Job attempt started",
      data,
    });
    adapter.jobAttemptStarted(data);
  },
  jobAttemptTakenByAnotherWorker(stateJob, options) {
    const data = {
      ...mapStateJobToJobAttemptData(stateJob),
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
  jobAttemptAlreadyCompleted(stateJob, options) {
    const data = {
      ...mapStateJobToJobProcessingData(stateJob),
      workerId: options.workerId,
      completedBy: stateJob.completedBy,
    };
    log({
      type: "job_attempt_already_completed",
      level: "warn",
      message: "Job already completed by another worker",
      data,
    });
    adapter.jobAttemptAlreadyCompleted(data);
  },
  jobAttemptExpired(stateJob, options) {
    const data = {
      ...mapStateJobToJobAttemptData(stateJob),
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
  jobAttemptExtended(stateJob, options) {
    const data = {
      ...mapStateJobToJobAttemptData(stateJob),
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
  jobAttemptReclaimed(stateJob, options) {
    const data = {
      ...mapStateJobToJobAttemptData(stateJob),
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
  jobAttemptFailed(stateJob, options) {
    const data = {
      ...mapStateJobToJobProcessingData(stateJob),
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
  jobAttemptCompleted(stateJob, options) {
    const data = {
      ...mapStateJobToJobCompletionData(stateJob, options),
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
  chainDuration(chain) {
    if (chain.completedAt) {
      const durationMs = chain.completedAt.getTime() - chain.createdAt.getTime();
      adapter.chainDuration({ ...mapChainToData(chain), durationMs });
    }
  },
  jobDuration(stateJob) {
    if (stateJob.completedAt) {
      const durationMs = stateJob.completedAt.getTime() - stateJob.createdAt.getTime();
      adapter.jobDuration({ ...mapStateJobToJobProcessingData(stateJob), durationMs });
    }
  },
  jobAttemptDuration(stateJob, options) {
    adapter.jobAttemptDuration({
      ...mapStateJobToJobProcessingData(stateJob),
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
  completeJobSpan: (stateJob, options) => {
    try {
      adapter.completeJobSpan({
        chainTraceContext: stateJob.chain.traceContext,
        traceContext: stateJob.traceContext,
        chainId: stateJob.chain.id,
        chainTypeName: stateJob.chain.typeName,
        jobId: stateJob.id,
        jobTypeName: stateJob.typeName,
        continuedWith: options.continuedWith
          ? { jobId: options.continuedWith.id, jobTypeName: options.continuedWith.typeName }
          : undefined,
        chainCompleted: options.chainCompleted,
      });
    } catch {}
  },
});
