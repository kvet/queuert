import { type StateJob, type StateJobInfo } from "../state-adapter/state-adapter.js";
import { type AnyJob } from "./job.types.js";

export type * from "./job.types.js";

/** Maps a state job to its public shape; a `continuation` it carries becomes `continuedTo`. */
export const mapStateJobToJob = (
  stateJob: StateJob & { continuation?: StateJobInfo },
): AnyJob & { continuedTo?: AnyJob } => {
  const base = {
    id: stateJob.id,
    chainId: stateJob.chainId,
    chainTypeName: stateJob.chain.typeName,
    chainIndex: stateJob.chainIndex,
    typeName: stateJob.typeName,
    input: stateJob.input,
    createdAt: stateJob.createdAt,
    scheduledAt: stateJob.scheduledAt,
    attempt: stateJob.attempt,
    lastAttemptAt: stateJob.lastAttemptAt,
    lastAttemptError: stateJob.lastAttemptError,
    ...(stateJob.continuation && {
      continuedTo: mapStateJobToJob({ ...stateJob.continuation, chain: stateJob.chain }),
    }),
  };

  switch (stateJob.status) {
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
        attemptUntil: stateJob.attemptUntil!,
      };
    case "blocked":
      return { ...base, status: "blocked" };
    case "pending":
      return { ...base, status: "pending" };
  }
};
