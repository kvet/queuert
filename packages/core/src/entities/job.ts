import { type StateJob } from "../state-adapter/state-adapter.js";
import { type Job, type JobWithoutBlockers } from "./job.types.js";

export * from "./job.types.js";

export const mapStateJobToJob = (
  stateJob: StateJob,
): JobWithoutBlockers<Job<any, any, any, any, any[]>> => {
  const base = {
    id: stateJob.id,
    chainId: stateJob.chainId,
    chainTypeName: stateJob.chainTypeName,
    originId: stateJob.originId,
    typeName: stateJob.typeName,
    input: stateJob.input,
    createdAt: stateJob.createdAt,
    scheduledAt: stateJob.scheduledAt,
    attempt: stateJob.attempt,
    lastAttemptAt: stateJob.lastAttemptAt,
    lastAttemptError: stateJob.lastAttemptError,
  };

  switch (stateJob.status) {
    case "completed":
      return {
        ...base,
        status: "completed",
        completedAt: stateJob.completedAt!,
        completedBy: stateJob.completedBy,
      };
    case "running":
      return {
        ...base,
        status: "running",
        leasedBy: stateJob.leasedBy ?? undefined,
        leasedUntil: stateJob.leasedUntil ?? undefined,
      };
    case "blocked":
      return { ...base, status: "blocked" };
    case "pending":
      return { ...base, status: "pending" };
  }
};
