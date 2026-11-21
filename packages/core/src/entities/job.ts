import { JobsTypeMismatchError } from "../errors.ts";
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
    consecutiveFailures: stateJob.consecutiveFailures,
    lastAttemptAt: stateJob.lastAttemptAt,
    lastAttemptError: stateJob.lastAttemptError,
    lastRescheduleReason: stateJob.lastRescheduleReason,
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

export const assertJobsTypeName = (
  stateJobs: (StateJobInfo | undefined)[],
  { jobIds, typeNames }: { jobIds: string[]; typeNames: (string | undefined)[] },
): void => {
  const mismatched = jobIds.flatMap((jobId, index) => {
    const stateJob = stateJobs[index];
    const typeName = typeNames[index];
    return typeName && stateJob !== undefined && stateJob.typeName !== typeName
      ? [{ jobId, expectedTypeName: typeName, actualTypeName: stateJob.typeName }]
      : [];
  });
  if (mismatched.length === 0) return;
  throw new JobsTypeMismatchError(
    `Jobs have a different type than expected: ${mismatched
      .map(
        ({ jobId, expectedTypeName, actualTypeName }) =>
          `${jobId} (expected "${expectedTypeName}", found "${actualTypeName}")`,
      )
      .join(", ")}`,
    {
      jobIds: mismatched.map(({ jobId }) => jobId),
      expectedTypeNames: mismatched.map(({ expectedTypeName }) => expectedTypeName),
      actualTypeNames: mismatched.map(({ actualTypeName }) => actualTypeName),
    },
  );
};
