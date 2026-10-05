import { type ScheduleOptions } from "../entities/schedule.js";
import { type BackoffConfig, calculateBackoffMs } from "../helpers/backoff.js";
import { serializeError } from "../helpers/serialize-error.js";
import { type Helpers } from "../setup-helpers.js";
import { type StateAttemptFence, type StateJob } from "../state-adapter/state-adapter.js";

/**
 * Reschedules a failed attempt with backoff, fenced on the attempt, in autocommit. Returns
 * `undefined` when the fence misses — the attempt no longer owns the job, or its own `finish`
 * already committed.
 */
export const rescheduleFailedAttempt = async (
  helpers: Helpers,
  {
    stateJob,
    error,
    backoffConfig,
    fence,
  }: {
    stateJob: StateJob;
    error: unknown;
    backoffConfig: BackoffConfig;
    fence: StateAttemptFence;
  },
): Promise<{ rescheduledJob: StateJob; schedule: ScheduleOptions } | undefined> => {
  const schedule: ScheduleOptions = {
    afterMs: calculateBackoffMs(stateJob.attempt, backoffConfig),
  };

  const [rescheduledJob] = await helpers.stateAdapter.rescheduleJobs({
    jobs: [{ jobId: stateJob.id, schedule, error: serializeError(error), fence }],
  });
  if (rescheduledJob === undefined) return undefined;

  helpers.observabilityHelper.jobRescheduled(rescheduledJob);
  helpers.observabilityHelper.jobAttemptFailed(stateJob, {
    workerId: fence.workerId,
    error,
  });

  return { rescheduledJob, schedule };
};
