import { type JobStatePredicate, type StateJob } from "../state-adapter/state-adapter.js";
import { type Job, type JobStatus } from "./job.types.js";

export type * from "./job.types.js";

/**
 * Derives a job's status from its structural columns. Status is never stored —
 * it is computed at read time. The order encodes the legal precedence:
 * completion (succeeded or terminal) wins over a stale lease; an active lease
 * wins over a runtime-added blocker; an absolute gate (blockers) beats a time
 * gate (`scheduledInFuture`); `scheduled` vs `ready` is the `scheduledInFuture`
 * flag, which the adapter snapshots against its own clock at read time.
 */
export const deriveJobStatus = (job: StateJob): JobStatus => {
  if (job.completedAt !== null && job.continuedToJobId !== null) return "succeeded";
  if (job.completedAt !== null) return "completed";
  if (job.leasedUntil !== null) return "running";
  if (job.hasOpenBlockers) return "blocked";
  if (job.scheduledInFuture) return "scheduled";
  return "ready";
};

/**
 * Translates a public job status into the structural predicate that selects it.
 * The predicates are mutually exclusive and mirror {@link deriveJobStatus}'s
 * precedence, so an OR-array of them reproduces a multi-status filter.
 */
export const jobStatusToPredicate = (status: JobStatus): JobStatePredicate => {
  switch (status) {
    case "succeeded":
      return { completed: true, succeeded: true };
    case "completed":
      return { completed: true, succeeded: false };
    case "running":
      return { completed: false, leased: true };
    case "blocked":
      return { completed: false, leased: false, hasOpenBlockers: true };
    case "scheduled":
      return { completed: false, leased: false, hasOpenBlockers: false, scheduledInFuture: true };
    case "ready":
      return { completed: false, leased: false, hasOpenBlockers: false, scheduledInFuture: false };
  }
};

export const mapStateJobToJob = (stateJob: StateJob): Job<any, any, any, any, any, boolean> => {
  const base = {
    id: stateJob.id,
    chainId: stateJob.chainId,
    chainTypeName: stateJob.chainTypeName,
    typeName: stateJob.typeName,
    input: stateJob.input,
    createdAt: stateJob.createdAt,
    scheduledAt: stateJob.scheduledAt,
    attempt: stateJob.attempt,
    lastAttemptAt: stateJob.lastAttemptAt,
    lastAttemptError: stateJob.lastAttemptError,
  };

  switch (deriveJobStatus(stateJob)) {
    case "succeeded":
      return {
        ...base,
        status: "succeeded",
        completedAt: stateJob.completedAt!,
        completedBy: stateJob.completedBy,
        continuedToJobId: stateJob.continuedToJobId!,
      };
    case "completed":
      return {
        ...base,
        status: "completed",
        completedAt: stateJob.completedAt!,
        completedBy: stateJob.completedBy,
        output: stateJob.output,
      };
    case "running":
      return {
        ...base,
        status: "running",
        leasedBy: stateJob.leasedBy!,
        leasedUntil: stateJob.leasedUntil!,
      };
    case "blocked":
      return { ...base, status: "blocked" };
    case "scheduled":
      return { ...base, status: "scheduled" };
    case "ready":
      return { ...base, status: "ready" };
  }
};
