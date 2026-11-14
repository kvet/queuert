import { JobTypeMismatchError } from "../errors.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import type { StateJob, StateJobInfo } from "../state-adapter/state-adapter.ts";
import type { AnyJob } from "./job.types.ts";

export type * from "./job.types.ts";

export const mapStateJobToJob = (
  stateJob: StateJob & { continuation?: StateJobInfo },
  jobTypes: Pick<JobTypes<any>, "decodeInput" | "decodeOutput">,
): AnyJob & { continuedTo?: AnyJob } => {
  const base = {
    id: stateJob.id,
    chainId: stateJob.chainId,
    chainTypeName: stateJob.chain.typeName,
    chainIndex: stateJob.chainIndex,
    typeName: stateJob.typeName,
    input: jobTypes.decodeInput(stateJob.typeName, stateJob.input),
    createdAt: stateJob.createdAt,
    scheduledAt: stateJob.scheduledAt,
    attempt: stateJob.attempt,
    lastAttemptAt: stateJob.lastAttemptAt,
    lastAttemptError: stateJob.lastAttemptError,
    ...(stateJob.continuation && {
      continuedTo: mapStateJobToJob({ ...stateJob.continuation, chain: stateJob.chain }, jobTypes),
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
        output: jobTypes.decodeOutput(stateJob.typeName, stateJob.output),
        continuedToId: null,
      };
    case "running":
      return {
        ...base,
        status: "running",
        attemptAt: stateJob.attemptAt!,
        attemptBy: stateJob.attemptBy!,
      };
    case "blocked":
      return { ...base, status: "blocked" };
    case "pending":
      return { ...base, status: "pending" };
  }
};

export const assertJobTypeName = (
  stateJob: StateJob | undefined,
  { jobId, typeName }: { jobId: string; typeName: string | undefined },
): void => {
  if (!typeName || stateJob === undefined || stateJob.typeName === typeName) return;
  throw new JobTypeMismatchError(
    `Expected job ${jobId} to have type "${typeName}" but found "${stateJob.typeName}"`,
    {
      expectedTypeName: typeName,
      actualTypeName: stateJob.typeName,
    },
  );
};
