import { type JobChain } from "../entities/job-chain.js";
import { type Job } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type JobTypeValidationError } from "../errors.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateAdapter, type StateJob } from "../state-adapter/state-adapter.js";
import { type JobBasicData, type JobChainData, type JobProcessingData, type Log } from "./log.js";
import { type ObservabilityAdapter } from "./observability-adapter.js";

// Mapper functions

const mapStateJobToJobBasicData = (job: StateJob): JobBasicData => ({
  id: job.id,
  typeName: job.typeName,
  originId: job.originId,
  chainId: job.chainId,
  chainTypeName: job.chainTypeName,
  rootChainId: job.rootChainId,
});

const mapStateJobToJobProcessingData = (job: StateJob): JobProcessingData => ({
  ...mapStateJobToJobBasicData(job),
  status: job.status,
  attempt: job.attempt,
});

const mapStateJobToJobChainData = (job: StateJob): JobChainData => ({
  id: job.chainId,
  typeName: job.chainTypeName,
  originId: job.originId,
  rootChainId: job.rootChainId,
});

const mapJobChainToData = (chain: JobChain<any, any, any, any>): JobChainData => ({
  id: chain.id,
  typeName: chain.typeName,
  originId: chain.originId,
  rootChainId: chain.rootChainId,
});

const mapJobToJobBasicData = (job: Job<any, any, any, any, any[]>): JobBasicData => ({
  id: job.id,
  typeName: job.typeName,
  originId: job.originId,
  chainId: job.chainId,
  chainTypeName: job.chainTypeName,
  rootChainId: job.rootChainId,
});

/**
 * High-level helper that wraps both Log and ObservabilityAdapter.
 *
 * Accepts domain objects (StateJob, Job, JobChain) and emits to both
 * logging and metrics on each event. This ensures consistency between
 * logs and metrics.
 */
export type ObservabilityHelper = {
  // worker
  workerStarted: (options: { workerId: string; jobTypeNames: string[] }) => void;
  workerError: (options: { workerId: string }, error: unknown) => void;
  workerStopping: (options: { workerId: string }) => void;
  workerStopped: (options: { workerId: string }) => void;
  // job
  jobCreated: (
    job: StateJob,
    options: {
      input: unknown;
      blockers: JobChain<any, any, any, any>[];
      schedule?: ScheduleOptions;
    },
  ) => void;
  jobAttemptStarted: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptTakenByAnotherWorker: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptAlreadyCompleted: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptLeaseExpired: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptLeaseRenewed: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptFailed: (
    job: StateJob,
    options: { workerId: string; rescheduledSchedule: ScheduleOptions; error: unknown },
  ) => void;
  jobAttemptCompleted: (
    job: StateJob,
    options: { output: unknown; continuedWith?: Job<any, any, any, any, any[]>; workerId: string },
  ) => void;
  jobCompleted: (
    job: StateJob,
    options: {
      output: unknown;
      continuedWith?: Job<any, any, any, any, any[]>;
      workerId: string | null;
    },
  ) => void;
  jobReaped: (job: StateJob, options: { workerId: string }) => void;
  // job chain
  jobChainCreated: (job: StateJob, options: { input: unknown }) => void;
  jobChainCompleted: (jobChainStartJob: StateJob, options: { output: unknown }) => void;
  // blockers
  jobBlocked: (job: StateJob, options: { blockedByChains: JobChain<any, any, any, any>[] }) => void;
  jobUnblocked: (job: StateJob, options: { unblockedByChain: StateJob }) => void;
  // notify adapter
  notifyContextAbsence: (job: StateJob) => void;
  notifyAdapterError: (operation: keyof NotifyAdapter, error: unknown) => void;
  // state adapter
  stateAdapterError: (operation: keyof StateAdapter<any, any>, error: unknown) => void;
  // job type validation
  jobTypeValidationError: (error: JobTypeValidationError) => void;
  // histograms
  jobChainDuration: (firstJob: StateJob, lastJob: StateJob) => void;
  jobDuration: (job: StateJob) => void;
  jobAttemptDuration: (job: StateJob, options: { durationMs: number; workerId: string }) => void;
  // gauges
  jobTypeIdleChange: (delta: number, workerId: string, typeNames: readonly string[]) => void;
  jobTypeProcessingChange: (delta: number, job: StateJob, workerId: string) => void;
};

export const createObservabilityHelper = ({
  log,
  adapter,
}: {
  log: Log;
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

  // job
  jobCreated(job, options) {
    const jobData = mapStateJobToJobBasicData(job);
    const blockersData = options.blockers.map(mapJobChainToData);
    const scheduledAt = options.schedule?.at;
    const scheduleAfterMs = options.schedule?.afterMs;

    log({
      type: "job_created",
      level: "info",
      message: "Job created",
      data: {
        ...jobData,
        input: options.input,
        blockers: blockersData,
        ...(scheduledAt && { scheduledAt }),
        ...(scheduleAfterMs && { scheduleAfterMs }),
      },
    });
    adapter.jobCreated({
      ...jobData,
      input: options.input,
      blockers: blockersData,
      ...(scheduledAt && { scheduledAt }),
      ...(scheduleAfterMs && { scheduleAfterMs }),
    });
  },

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
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
      leasedBy: job.leasedBy!,
      leasedUntil: job.leasedUntil!,
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

  jobAttemptLeaseExpired(job, options) {
    const data = {
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
      leasedBy: job.leasedBy!,
      leasedUntil: job.leasedUntil!,
    };
    log({
      type: "job_attempt_lease_expired",
      level: "warn",
      message: "Job lease expired",
      data,
    });
    adapter.jobAttemptLeaseExpired(data);
  },

  jobAttemptLeaseRenewed(job, options) {
    const data = {
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
      leasedBy: job.leasedBy!,
      leasedUntil: job.leasedUntil!,
    };
    log({
      type: "job_attempt_lease_renewed",
      level: "info",
      message: "Job lease renewed",
      data,
    });
    adapter.jobAttemptLeaseRenewed(data);
  },

  jobReaped(job, options) {
    const data = {
      ...mapStateJobToJobBasicData(job),
      leasedBy: job.leasedBy!,
      leasedUntil: job.leasedUntil!,
      workerId: options.workerId,
    };
    log({
      type: "job_reaped",
      level: "info",
      message: "Reaped expired job lease",
      data,
    });
    adapter.jobReaped(data);
  },

  jobAttemptFailed(job, options) {
    const rescheduledAt = options.rescheduledSchedule.at;
    const rescheduledAfterMs = options.rescheduledSchedule.afterMs;
    const data = {
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
      ...(rescheduledAt && { rescheduledAt }),
      ...(rescheduledAfterMs && { rescheduledAfterMs }),
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
    const continuedWithData = options.continuedWith
      ? mapJobToJobBasicData(options.continuedWith)
      : undefined;
    const data = {
      ...mapStateJobToJobProcessingData(job),
      output: options.output,
      continuedWith: continuedWithData,
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

  jobCompleted(job, options) {
    const continuedWithData = options.continuedWith
      ? mapJobToJobBasicData(options.continuedWith)
      : undefined;
    const data = {
      ...mapStateJobToJobProcessingData(job),
      output: options.output,
      continuedWith: continuedWithData,
      workerId: options.workerId,
    };
    log({
      type: "job_completed",
      level: "info",
      message: "Job completed",
      data,
    });
    adapter.jobCompleted(data);
  },

  // job chain
  jobChainCreated(job, options) {
    const data = { ...mapStateJobToJobChainData(job), input: options.input };
    log({
      type: "job_chain_created",
      level: "info",
      message: "Job chain created",
      data,
    });
    adapter.jobChainCreated(data);
  },

  jobChainCompleted(jobChainStartJob, options) {
    const data = { ...mapStateJobToJobChainData(jobChainStartJob), output: options.output };
    log({
      type: "job_chain_completed",
      level: "info",
      message: "Job chain completed",
      data,
    });
    adapter.jobChainCompleted(data);
  },

  // blockers
  jobBlocked(job, options) {
    const blockedByChains = options.blockedByChains.map(mapJobChainToData);
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
    const unblockedByChain = mapStateJobToJobChainData(options.unblockedByChain);
    log({
      type: "job_unblocked",
      level: "info",
      message: "Job unblocked",
      data: { ...mapStateJobToJobBasicData(job), unblockedByChain },
    });
    adapter.jobUnblocked({ ...mapStateJobToJobBasicData(job), unblockedByChain });
  },

  // notify adapter
  notifyContextAbsence(job) {
    const data = mapStateJobToJobBasicData(job);
    log({
      type: "notify_context_absence",
      level: "warn",
      message:
        "Not withNotify context when creating job for queue. The job processing may be delayed.",
      data,
    });
    adapter.notifyContextAbsence(data);
  },

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

  // histograms (no logging, metrics only)
  jobChainDuration(firstJob, lastJob) {
    if (lastJob.completedAt && firstJob.createdAt) {
      const durationMs = lastJob.completedAt.getTime() - firstJob.createdAt.getTime();
      adapter.jobChainDuration({ ...mapStateJobToJobChainData(firstJob), durationMs });
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

  // gauges (no logging, metrics only)
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
});
