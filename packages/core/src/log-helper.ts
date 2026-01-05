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
  rootId: job.rootId,
});

const mapStateJobToJobProcessingLogArgs = (job: StateJob): JobProcessingArgs => ({
  ...mapStateJobToJobBasicLogArgs(job),
  status: job.status,
  attempt: job.attempt,
});

const mapStateJobToJobSequenceLogArgs = (job: StateJob): JobSequenceArgs => ({
  sequenceId: job.sequenceId,
  firstJobTypeName: job.typeName,
  originId: job.originId,
  rootId: job.rootId,
});

const mapJobSequenceToLogArgs = (seq: JobSequence<any, any, any, any>): JobSequenceArgs => ({
  sequenceId: seq.id,
  firstJobTypeName: seq.firstJobTypeName,
  originId: seq.originId,
  rootId: seq.rootId,
});

const mapJobToJobBasicLogArgs = (job: Job<any, any, any, any>): JobBasicArgs => ({
  id: job.id,
  typeName: job.typeName,
  originId: job.originId,
  sequenceId: job.sequenceId,
  rootId: job.rootId,
});

export type LogHelper = {
  jobSequenceCreated: (job: StateJob, options: { input: unknown }) => void;
  jobCreated: (
    job: StateJob,
    options: {
      input: unknown;
      blockers: JobSequence<any, any, any, any>[];
      schedule?: ScheduleOptions;
    },
  ) => void;
  notifyContextAbsence: (job: StateJob) => void;
  jobCompleted: (
    job: StateJob,
    options: { output: unknown; continuedWith?: Job<any, any, any, any>; workerId: string | null },
  ) => void;
  jobSequenceCompleted: (jobSequenceStartJob: StateJob, options: { output: unknown }) => void;
  jobSequenceUnblockedJobs: (
    jobSequenceStartJob: StateJob,
    options: { unblockedJobs: StateJob[] },
  ) => void;
  jobAttemptFailed: (
    job: StateJob,
    options: { workerId: string; rescheduledSchedule: ScheduleOptions; error: unknown },
  ) => void;
  jobTakenByAnotherWorker: (job: StateJob, options: { workerId: string }) => void;
  jobLeaseExpired: (job: StateJob, options: { workerId: string }) => void;
  jobAttemptStarted: (job: StateJob, options: { workerId: string }) => void;
  jobReaped: (job: StateJob, options: { workerId: string }) => void;
  jobSequenceDeleted: (sequenceJob: StateJob, options: { deletedJobIds: string[] }) => void;
};

export const createLogHelper = ({ log }: { log: Log }): LogHelper => ({
  jobSequenceCreated(job, options) {
    log({
      type: "job_sequence_created",
      level: "info",
      message: "Job sequence created",
      args: [{ ...mapStateJobToJobSequenceLogArgs(job), input: options.input }],
    });
  },

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

  notifyContextAbsence(job) {
    log({
      type: "notify_context_absence",
      level: "warn",
      message:
        "Not withNotify context when creating job for queue. The job processing may be delayed.",
      args: [mapStateJobToJobBasicLogArgs(job)],
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

  jobSequenceCompleted(jobSequenceStartJob, options) {
    log({
      type: "job_sequence_completed",
      level: "info",
      message: "Job sequence completed",
      args: [{ ...mapStateJobToJobSequenceLogArgs(jobSequenceStartJob), output: options.output }],
    });
  },

  jobSequenceUnblockedJobs(jobSequenceStartJob, options) {
    log({
      type: "job_sequence_unblocked_jobs",
      level: "info",
      message: "Job sequence completed and unblocked jobs",
      args: [
        {
          ...mapStateJobToJobSequenceLogArgs(jobSequenceStartJob),
          unblockedJobs: options.unblockedJobs.map(mapStateJobToJobBasicLogArgs),
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

  jobAttemptStarted(job, options) {
    log({
      type: "job_attempt_started",
      level: "info",
      message: "Job attempt started",
      args: [{ ...mapStateJobToJobProcessingLogArgs(job), workerId: options.workerId }],
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
});
