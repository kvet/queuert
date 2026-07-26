import { type StateJob } from "../state-adapter/state-adapter.js";
import { type JobTypes, type ResolvedJobTypeValue } from "./job-types.js";
import { type AnyJob, type JobStatus } from "./job.types.js";

export type * from "./job.types.js";

export const deriveStatus = (stateJob: Pick<StateJob, "completedAt" | "attemptAt">): JobStatus =>
  stateJob.completedAt !== null ? "completed" : stateJob.attemptAt !== null ? "running" : "pending";

/**
 * Batch-decode and project a page of {@link StateJob}s into {@link Job}s.
 *
 * Issues a single `decode` call covering every job's input plus the output of
 * every job that completed without continuing (heterogeneous in `direction`).
 * The result preserves the input order. Single-job sites call this with
 * `[job]` and unwrap.
 */
export const mapStateJobsToJobs = async (
  stateJobs: readonly StateJob[],
  jobTypes: Pick<JobTypes<any>, "decode">,
): Promise<AnyJob[]> => {
  if (stateJobs.length === 0) return [];

  const items: ResolvedJobTypeValue[] = [];
  const inputIndices: number[] = Array.from({ length: stateJobs.length });
  const outputIndices = new Map<number, number>();

  for (let i = 0; i < stateJobs.length; i++) {
    const job = stateJobs[i];
    inputIndices[i] = items.length;
    items.push({ typeName: job.typeName, direction: "input", value: job.input });
    if (deriveStatus(job) === "completed" && job.continuedToId === null) {
      outputIndices.set(i, items.length);
      items.push({ typeName: job.typeName, direction: "output", value: job.output });
    }
  }

  const decoded = await jobTypes.decode(items);

  return stateJobs.map((stateJob, i) => {
    const base = {
      id: stateJob.id,
      chainId: stateJob.chainId,
      chainTypeName: stateJob.chainTypeName,
      typeName: stateJob.typeName,
      input: decoded[inputIndices[i]],
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
          output: decoded[outputIndices.get(i)!],
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
  });
};
