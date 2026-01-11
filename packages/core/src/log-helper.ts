import { JobSequence } from "./entities/job-sequence.js";
import { Job } from "./entities/job.js";
import { ScheduleOptions } from "./entities/schedule.js";
import { JobBasicData, JobProcessingData, JobSequenceData, Log } from "./log.js";
import { StateJob } from "./state-adapter/state-adapter.js";

const mapStateJobToJobBasicLogData = (job: StateJob): JobBasicData => ({
  id: job.id,
  typeName: job.typeName,
  originId: job.originId,
  sequenceId: job.sequenceId,
  rootSequenceId: job.rootSequenceId,
});

const mapStateJobToJobProcessingLogData = (job: StateJob): JobProcessingData => ({
  ...mapStateJobToJobBasicLogData(job),
  status: job.status,
  attempt: job.attempt,
});

const mapStateJobToJobSequenceLogData = (job: StateJob): JobSequenceData => ({
  id: job.sequenceId,
  typeName: job.sequenceTypeName,
  originId: job.originId,
  rootSequenceId: job.rootSequenceId,
});

const mapJobSequenceToLogData = (seq: JobSequence<any, any, any, any>): JobSequenceData => ({
  id: seq.id,
  typeName: seq.typeName,
  originId: seq.originId,
  rootSequenceId: seq.rootSequenceId,
});

const mapJobToJobBasicLogData = (job: Job<any, any, any, any, any[]>): JobBasicData => ({
  id: job.id,
  typeName: job.typeName,
  originId: job.originId,
  sequenceId: job.sequenceId,
  rootSequenceId: job.rootSequenceId,
});

export type LogHelper = {
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
  jobReaped: (job: StateJob, options: { workerId: string }) => void;
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
  notifyAdapterError: (operation: string, error: unknown) => void;
  // state adapter
  stateAdapterError: (operation: string, error: unknown) => void;
};

export const createLogHelper = ({ log }: { log: Log }): LogHelper => ({
  // worker
  workerStarted(options) {
    log({
      type: "worker_started",
      level: "info",
      message: "Started worker",
      data: options,
    });
  },

  workerError(options, error) {
    log({
      type: "worker_error",
      level: "error",
      message: "Worker error",
      data: options,
      error,
    });
  },

  workerStopping(options) {
    log({
      type: "worker_stopping",
      level: "info",
      message: "Stopping worker...",
      data: options,
    });
  },

  workerStopped(options) {
    log({
      type: "worker_stopped",
      level: "info",
      message: "Worker has been stopped",
      data: options,
    });
  },

  // job
  jobCreated(job, options) {
    log({
      type: "job_created",
      level: "info",
      message: "Job created",
      data: {
        ...mapStateJobToJobBasicLogData(job),
        input: options.input,
        blockers: options.blockers.map(mapJobSequenceToLogData),
        ...(options.schedule?.at && { scheduledAt: options.schedule.at }),
        ...(options.schedule?.afterMs && { scheduleAfterMs: options.schedule.afterMs }),
      },
    });
  },

  jobAttemptStarted(job, options) {
    log({
      type: "job_attempt_started",
      level: "info",
      message: "Job attempt started",
      data: { ...mapStateJobToJobProcessingLogData(job), workerId: options.workerId },
    });
  },

  jobTakenByAnotherWorker(job, options) {
    log({
      type: "job_taken_by_another_worker",
      level: "warn",
      message: "Job taken by another worker",
      data: {
        ...mapStateJobToJobProcessingLogData(job),
        workerId: options.workerId,
        leasedBy: job.leasedBy!,
        leasedUntil: job.leasedUntil!,
      },
    });
  },

  jobLeaseExpired(job, options) {
    log({
      type: "job_lease_expired",
      level: "warn",
      message: "Job lease expired",
      data: {
        ...mapStateJobToJobProcessingLogData(job),
        workerId: options.workerId,
        leasedBy: job.leasedBy!,
        leasedUntil: job.leasedUntil!,
      },
    });
  },

  jobReaped(job, options) {
    log({
      type: "job_reaped",
      level: "info",
      message: "Reaped expired job lease",
      data: {
        ...mapStateJobToJobBasicLogData(job),
        leasedBy: job.leasedBy!,
        leasedUntil: job.leasedUntil!,
        workerId: options.workerId,
      },
    });
  },

  jobAttemptFailed(job, options) {
    log({
      type: "job_attempt_failed",
      level: "error",
      message: "Job attempt failed",
      data: {
        ...mapStateJobToJobProcessingLogData(job),
        workerId: options.workerId,
        ...(options.rescheduledSchedule.at && { rescheduledAt: options.rescheduledSchedule.at }),
        ...(options.rescheduledSchedule.afterMs && {
          rescheduledAfterMs: options.rescheduledSchedule.afterMs,
        }),
      },
      error: options.error,
    });
  },

  jobAttemptCompleted(job, options) {
    log({
      type: "job_attempt_completed",
      level: "info",
      message: "Job attempt completed",
      data: {
        ...mapStateJobToJobProcessingLogData(job),
        output: options.output,
        continuedWith: options.continuedWith
          ? mapJobToJobBasicLogData(options.continuedWith)
          : undefined,
        workerId: options.workerId,
      },
    });
  },

  jobCompleted(job, options) {
    log({
      type: "job_completed",
      level: "info",
      message: "Job completed",
      data: {
        ...mapStateJobToJobProcessingLogData(job),
        output: options.output,
        continuedWith: options.continuedWith
          ? mapJobToJobBasicLogData(options.continuedWith)
          : undefined,
        workerId: options.workerId,
      },
    });
  },

  // job sequence
  jobSequenceCreated(job, options) {
    log({
      type: "job_sequence_created",
      level: "info",
      message: "Job sequence created",
      data: { ...mapStateJobToJobSequenceLogData(job), input: options.input },
    });
  },

  jobSequenceCompleted(jobSequenceStartJob, options) {
    log({
      type: "job_sequence_completed",
      level: "info",
      message: "Job sequence completed",
      data: { ...mapStateJobToJobSequenceLogData(jobSequenceStartJob), output: options.output },
    });
  },

  jobSequenceDeleted(sequenceJob, options) {
    log({
      type: "job_sequence_deleted",
      level: "info",
      message: "Job sequence deleted",
      data: {
        ...mapStateJobToJobSequenceLogData(sequenceJob),
        deletedJobIds: options.deletedJobIds,
      },
    });
  },

  // blockers
  jobBlocked(job, options) {
    log({
      type: "job_blocked",
      level: "info",
      message: "Job blocked by incomplete sequences",
      data: {
        ...mapStateJobToJobBasicLogData(job),
        blockedBySequences: options.blockedBySequences.map(mapJobSequenceToLogData),
      },
    });
  },

  jobUnblocked(job, options) {
    log({
      type: "job_unblocked",
      level: "info",
      message: "Job unblocked",
      data: {
        ...mapStateJobToJobBasicLogData(job),
        unblockedBySequence: mapStateJobToJobSequenceLogData(options.unblockedBySequence),
      },
    });
  },

  // notify adapter
  notifyContextAbsence(job) {
    log({
      type: "notify_context_absence",
      level: "warn",
      message:
        "Not withNotify context when creating job for queue. The job processing may be delayed.",
      data: mapStateJobToJobBasicLogData(job),
    });
  },

  notifyAdapterError(operation, error) {
    log({
      type: "notify_adapter_error",
      level: "warn",
      message: "Notify adapter error",
      data: { operation },
      error,
    });
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
  },
});
