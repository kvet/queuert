import { type StateJob } from "../state-adapter/state-adapter.js";
import { type Job } from "./job.types.js";

export type * from "./job.types.js";

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

  switch (stateJob.status) {
    case "completed":
      if (stateJob.continuedToJobId !== null) {
        return {
          ...base,
          status: "completed",
          completedAt: stateJob.completedAt!,
          completedBy: stateJob.completedBy,
          continuedToJobId: stateJob.continuedToJobId,
        };
      }
      return {
        ...base,
        status: "completed",
        completedAt: stateJob.completedAt!,
        completedBy: stateJob.completedBy,
        output: stateJob.output,
        continuedToJobId: null,
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
