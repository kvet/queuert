import { JobSequence } from "../entities/job-sequence.js";
import { Job } from "../entities/job.js";
import { ScheduleOptions } from "../entities/schedule.js";
import { JobBasicData, JobProcessingData, JobSequenceData, Log } from "./log.js";
import { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { StateAdapter, StateJob } from "../state-adapter/state-adapter.js";
import { ObservabilityAdapter } from "./observability-adapter.js";

// Mapper functions

const mapStateJobToJobBasicData = (job: StateJob): JobBasicData => ({
  id: job.id,
  typeName: job.typeName,
  originId: job.originId,
  sequenceId: job.sequenceId,
  sequenceTypeName: job.sequenceTypeName,
  rootSequenceId: job.rootSequenceId,
});

const mapStateJobToJobProcessingData = (job: StateJob): JobProcessingData => ({
  ...mapStateJobToJobBasicData(job),
  status: job.status,
  attempt: job.attempt,
});

const mapStateJobToJobSequenceData = (job: StateJob): JobSequenceData => ({
  id: job.sequenceId,
  typeName: job.sequenceTypeName,
  originId: job.originId,
  rootSequenceId: job.rootSequenceId,
});

const mapJobSequenceToData = (seq: JobSequence<any, any, any, any>): JobSequenceData => ({
  id: seq.id,
  typeName: seq.typeName,
  originId: seq.originId,
  rootSequenceId: seq.rootSequenceId,
});

const mapJobToJobBasicData = (job: Job<any, any, any, any, any[]>): JobBasicData => ({
  id: job.id,
  typeName: job.typeName,
  originId: job.originId,
  sequenceId: job.sequenceId,
  sequenceTypeName: job.sequenceTypeName,
  rootSequenceId: job.rootSequenceId,
});

/**
 * High-level helper that wraps both Log and ObservabilityAdapter.
 *
 * Accepts domain objects (StateJob, Job, JobSequence) and emits to both
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
      blockers: JobSequence<any, any, any, any>[];
      schedule?: ScheduleOptions;
    },
  ) => void;
  jobAttemptStarted: (job: StateJob, options: { workerId: string }) => void;
  jobTakenByAnotherWorker: (job: StateJob, options: { workerId: string }) => void;
  jobLeaseExpired: (job: StateJob, options: { workerId: string }) => void;
  jobLeaseRenewed: (job: StateJob, options: { workerId: string }) => void;
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
  // job sequence
  jobSequenceCreated: (job: StateJob, options: { input: unknown }) => void;
  jobSequenceCompleted: (jobSequenceStartJob: StateJob, options: { output: unknown }) => void;
  jobSequenceDeleted: (sequenceJob: StateJob, options: { deletedJobIds: string[] }) => void;
  // blockers
  jobBlocked: (
    job: StateJob,
    options: { blockedBySequences: JobSequence<any, any, any, any>[] },
  ) => void;
  jobUnblocked: (job: StateJob, options: { unblockedBySequence: StateJob }) => void;
  // notify adapter
  notifyContextAbsence: (job: StateJob) => void;
  notifyAdapterError: (operation: keyof NotifyAdapter, error: unknown) => void;
  // state adapter
  stateAdapterError: (operation: keyof StateAdapter<any, any, any>, error: unknown) => void;
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
    const blockersData = options.blockers.map(mapJobSequenceToData);
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

  jobTakenByAnotherWorker(job, options) {
    const data = {
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
      leasedBy: job.leasedBy!,
      leasedUntil: job.leasedUntil!,
    };
    log({
      type: "job_taken_by_another_worker",
      level: "warn",
      message: "Job taken by another worker",
      data,
    });
    adapter.jobTakenByAnotherWorker(data);
  },

  jobLeaseExpired(job, options) {
    const data = {
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
      leasedBy: job.leasedBy!,
      leasedUntil: job.leasedUntil!,
    };
    log({
      type: "job_lease_expired",
      level: "warn",
      message: "Job lease expired",
      data,
    });
    adapter.jobLeaseExpired(data);
  },

  jobLeaseRenewed(job, options) {
    const data = {
      ...mapStateJobToJobProcessingData(job),
      workerId: options.workerId,
      leasedBy: job.leasedBy!,
      leasedUntil: job.leasedUntil!,
    };
    log({
      type: "job_lease_renewed",
      level: "info",
      message: "Job lease renewed",
      data,
    });
    adapter.jobLeaseRenewed(data);
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

  // job sequence
  jobSequenceCreated(job, options) {
    const data = { ...mapStateJobToJobSequenceData(job), input: options.input };
    log({
      type: "job_sequence_created",
      level: "info",
      message: "Job sequence created",
      data,
    });
    adapter.jobSequenceCreated(data);
  },

  jobSequenceCompleted(jobSequenceStartJob, options) {
    const data = { ...mapStateJobToJobSequenceData(jobSequenceStartJob), output: options.output };
    log({
      type: "job_sequence_completed",
      level: "info",
      message: "Job sequence completed",
      data,
    });
    adapter.jobSequenceCompleted(data);
  },

  jobSequenceDeleted(sequenceJob, options) {
    const data = {
      ...mapStateJobToJobSequenceData(sequenceJob),
      deletedJobIds: options.deletedJobIds,
    };
    log({
      type: "job_sequence_deleted",
      level: "info",
      message: "Job sequence deleted",
      data,
    });
    adapter.jobSequenceDeleted(data);
  },

  // blockers
  jobBlocked(job, options) {
    const blockedBySequences = options.blockedBySequences.map(mapJobSequenceToData);
    const data = { ...mapStateJobToJobBasicData(job), blockedBySequences };
    log({
      type: "job_blocked",
      level: "info",
      message: "Job blocked by incomplete sequences",
      data,
    });
    adapter.jobBlocked(data);
  },

  jobUnblocked(job, options) {
    const unblockedBySequence = mapStateJobToJobSequenceData(options.unblockedBySequence);
    log({
      type: "job_unblocked",
      level: "info",
      message: "Job unblocked",
      data: { ...mapStateJobToJobBasicData(job), unblockedBySequence },
    });
    adapter.jobUnblocked({ ...mapStateJobToJobBasicData(job), unblockedBySequence });
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
});
