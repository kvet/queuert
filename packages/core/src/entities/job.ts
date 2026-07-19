import { type StateJob } from "../state-adapter/state-adapter.js";
import { type AnyJob, type JobStatus } from "./job.types.js";

export type * from "./job.types.js";

export const deriveStatus = (stateJob: Pick<StateJob, "completedAt" | "attemptAt">): JobStatus =>
  stateJob.completedAt !== null ? "completed" : stateJob.attemptAt !== null ? "running" : "pending";

export const mapStateJobToJob = (stateJob: StateJob): AnyJob => {
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

  switch (deriveStatus(stateJob)) {
    case "completed":
      if (stateJob.continuedToId !== null) {
        return {
          ...base,
          status: "completed",
          completedAt: stateJob.completedAt!,
          completedBy: stateJob.completedBy,
          continuedToId: stateJob.continuedToId,
        };
      }
      return {
        ...base,
        status: "completed",
        completedAt: stateJob.completedAt!,
        completedBy: stateJob.completedBy,
        output: stateJob.output,
        continuedToId: null,
      };
    case "running":
      return {
        ...base,
        status: "running",
        attemptAt: stateJob.attemptAt!,
        attemptBy: stateJob.attemptBy!,
        attemptUntil: stateJob.attemptUntil,
      };
    case "pending":
      return { ...base, status: "pending", blocked: stateJob.blocked };
  }
};
