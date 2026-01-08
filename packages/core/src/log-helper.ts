import { JobSequence } from "./entities/job-sequence.js";
import { Job } from "./entities/job.js";
import { ScheduleOptions } from "./entities/schedule.js";
import { JobBasicArgs, JobProcessingArgs, JobSequenceArgs, Log } from "./log.js";
import { StateJob } from "./state-adapter/state-adapter.js";

const mapStateJobToJobBasicLogArgs = (job: StateJob): JobBasicArgs => ({
  id: job.id,
  typeName: job.typeName,
  originId: job.originId,
  sequenceId: job.sequenceId,
  rootSequenceId: job.rootSequenceId,
});

const mapStateJobToJobProcessingLogArgs = (job: StateJob): JobProcessingArgs => ({
  ...mapStateJobToJobBasicLogArgs(job),
  status: job.status,
  attempt: job.attempt,
});

const mapStateJobToJobSequenceLogArgs = (job: StateJob): JobSequenceArgs => ({
  id: job.sequenceId,
  typeName: job.sequenceTypeName,
  originId: job.originId,
  rootSequenceId: job.rootSequenceId,
});

const mapJobSequenceToLogArgs = (seq: JobSequence<any, any, any, any>): JobSequenceArgs => ({
  id: seq.id,
  typeName: seq.typeName,
  originId: seq.originId,
  rootSequenceId: seq.rootSequenceId,
});

const mapJobToJobBasicLogArgs = (job: Job<any, any, any, any>): JobBasicArgs => ({
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
    options: { output: unknown; continuedWith?: Job<any, any, any, any>; workerId: string },
  ) => void;
  jobCompleted: (
    job: StateJob,
    options: { output: unknown; continuedWith?: Job<any, any, any, any>; workerId: string | null },
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
      args: [options],
    });
  },

  workerError(options, error) {
    log({
      type: "worker_error",
      level: "error",
      message: "Worker error",
      args: [options, error],
    });
  },

  workerStopping(options) {
    log({
      type: "worker_stopping",
      level: "info",
      message: "Stopping worker...",
      args: [options],
    });
  },

  workerStopped(options) {
    log({
      type: "worker_stopped",
      level: "info",
      message: "Worker has been stopped",
      args: [options],
    });
  },

  // job
  jobCreated(job, options) {
    log({
      type: "job_created",
      level: "info",
      message: "Job created",
      args: [
        {
          ...mapStateJobToJobBasicLogArgs(job),
          input: options.input,
          blockers: options.blockers.map(mapJobSequenceToLogArgs),
          ...(options.schedule?.at && { scheduledAt: options.schedule.at }),
          ...(options.schedule?.afterMs && { scheduleAfterMs: options.schedule.afterMs }),
        },
      ],
    });
  },

  jobAttemptStarted(job, options) {
    log({
      type: "job_attempt_started",
      level: "info",
      message: "Job attempt started",
      args: [{ ...mapStateJobToJobProcessingLogArgs(job), workerId: options.workerId }],
    });
  },

  jobTakenByAnotherWorker(job, options) {
    log({
      type: "job_taken_by_another_worker",
      level: "warn",
      message: "Job taken by another worker",
      args: [
        {
          ...mapStateJobToJobProcessingLogArgs(job),
          workerId: options.workerId,
          leasedBy: job.leasedBy!,
          leasedUntil: job.leasedUntil!,
        },
      ],
    });
  },

  jobLeaseExpired(job, options) {
    log({
      type: "job_lease_expired",
      level: "warn",
      message: "Job lease expired",
      args: [
        {
          ...mapStateJobToJobProcessingLogArgs(job),
          workerId: options.workerId,
          leasedBy: job.leasedBy!,
          leasedUntil: job.leasedUntil!,
        },
      ],
    });
  },

  jobReaped(job, options) {
    log({
      type: "job_reaped",
      level: "info",
      message: "Reaped expired job lease",
      args: [
        {
          ...mapStateJobToJobBasicLogArgs(job),
          leasedBy: job.leasedBy!,
          leasedUntil: job.leasedUntil!,
          workerId: options.workerId,
        },
      ],
    });
  },

  jobAttemptFailed(job, options) {
    log({
      type: "job_attempt_failed",
      level: "error",
      message: "Job attempt failed",
      args: [
        {
          ...mapStateJobToJobProcessingLogArgs(job),
          workerId: options.workerId,
          ...(options.rescheduledSchedule.at && { rescheduledAt: options.rescheduledSchedule.at }),
          ...(options.rescheduledSchedule.afterMs && {
            rescheduledAfterMs: options.rescheduledSchedule.afterMs,
          }),
        },
        options.error,
      ],
    });
  },

  jobAttemptCompleted(job, options) {
    log({
      type: "job_attempt_completed",
      level: "info",
      message: "Job attempt completed",
      args: [
        {
          ...mapStateJobToJobProcessingLogArgs(job),
          output: options.output,
          continuedWith: options.continuedWith
            ? mapJobToJobBasicLogArgs(options.continuedWith)
            : undefined,
          workerId: options.workerId,
        },
      ],
    });
  },

  jobCompleted(job, options) {
    log({
      type: "job_completed",
      level: "info",
      message: "Job completed",
      args: [
        {
          ...mapStateJobToJobProcessingLogArgs(job),
          output: options.output,
          continuedWith: options.continuedWith
            ? mapJobToJobBasicLogArgs(options.continuedWith)
            : undefined,
          workerId: options.workerId,
        },
      ],
    });
  },

  // job sequence
  jobSequenceCreated(job, options) {
    log({
      type: "job_sequence_created",
      level: "info",
      message: "Job sequence created",
      args: [{ ...mapStateJobToJobSequenceLogArgs(job), input: options.input }],
    });
  },

  jobSequenceCompleted(jobSequenceStartJob, options) {
    log({
      type: "job_sequence_completed",
      level: "info",
      message: "Job sequence completed",
      args: [{ ...mapStateJobToJobSequenceLogArgs(jobSequenceStartJob), output: options.output }],
    });
  },

  jobSequenceDeleted(sequenceJob, options) {
    log({
      type: "job_sequence_deleted",
      level: "info",
      message: "Job sequence deleted",
      args: [
        {
          ...mapStateJobToJobSequenceLogArgs(sequenceJob),
          deletedJobIds: options.deletedJobIds,
        },
      ],
    });
  },

  // blockers
  jobBlocked(job, options) {
    log({
      type: "job_blocked",
      level: "info",
      message: "Job blocked by incomplete sequences",
      args: [
        {
          ...mapStateJobToJobBasicLogArgs(job),
          blockedBySequences: options.blockedBySequences.map(mapJobSequenceToLogArgs),
        },
      ],
    });
  },

  jobUnblocked(job, options) {
    log({
      type: "job_unblocked",
      level: "info",
      message: "Job unblocked",
      args: [
        {
          ...mapStateJobToJobBasicLogArgs(job),
          unblockedBySequence: mapStateJobToJobSequenceLogArgs(options.unblockedBySequence),
        },
      ],
    });
  },

  // notify adapter
  notifyContextAbsence(job) {
    log({
      type: "notify_context_absence",
      level: "warn",
      message:
        "Not withNotify context when creating job for queue. The job processing may be delayed.",
      args: [mapStateJobToJobBasicLogArgs(job)],
    });
  },

  notifyAdapterError(operation, error) {
    log({
      type: "notify_adapter_error",
      level: "warn",
      message: "Notify adapter error",
      args: [{ operation }, error],
    });
  },

  // state adapter
  stateAdapterError(operation, error) {
    log({
      type: "state_adapter_error",
      level: "warn",
      message: "State adapter error",
      args: [{ operation }, error],
    });
  },
});
