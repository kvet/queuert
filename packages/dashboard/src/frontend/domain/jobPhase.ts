import type { UnknownJob } from "../../shared/types.ts";

/**
 * A derived view of a job's state for the chain detail sequence and job detail. It is not a
 * status: the status pill always shows `job.status`. `rescheduledAfterError` is a pending job a
 * failure rescheduled, so its `consecutiveFailures` is above 0; a job a client rescheduled after a
 * failure is `scheduled` or `due`. The error belongs to *some* earlier attempt, so no attempt
 * number is ever attached to it.
 */
export const jobPhase = (
  job: UnknownJob,
  now: number,
):
  | { phase: "blocked" }
  | { phase: "running"; hadError: boolean }
  | { phase: "rescheduledAfterError" }
  | { phase: "scheduled"; rescheduled: boolean }
  | { phase: "due"; rescheduled: boolean }
  | { phase: "continued"; workerless: boolean }
  | { phase: "tail"; workerless: boolean } => {
  switch (job.status) {
    case "blocked":
      return { phase: "blocked" };
    case "running":
      return { phase: "running", hadError: job.consecutiveFailures > 0 };
    case "pending":
      if (job.consecutiveFailures > 0) return { phase: "rescheduledAfterError" };
      return job.scheduledAt.getTime() > now
        ? { phase: "scheduled", rescheduled: job.attempt > 0 }
        : { phase: "due", rescheduled: job.attempt > 0 };
    case "completed":
      return job.continuedToId !== null
        ? { phase: "continued", workerless: job.attempt === 0 }
        : { phase: "tail", workerless: job.attempt === 0 };
  }
};
