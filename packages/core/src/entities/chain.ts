import { type StateJob } from "../state-adapter/state-adapter.js";
import { type Chain } from "./chain.types.js";
import { type JobTypes, type ResolvedJobTypeValue } from "./job-types.js";

export type * from "./chain.types.js";

/**
 * Batch-decode and project a page of `[initialJob, currentJob]` state pairs
 * into {@link Chain}s.
 *
 * Issues a single `decode` call covering every chain's initial-job input plus
 * every completed chain's effective-job output (heterogeneous in `direction`).
 * The result preserves input order. Single-pair sites call this with `[pair]`
 * and unwrap.
 */
export const mapStatePairsToChains = async (
  stateJobPairs: readonly [StateJob, StateJob | undefined][],
  jobTypes: Pick<JobTypes<any>, "decode">,
): Promise<Chain<any, any, any, any>[]> => {
  if (stateJobPairs.length === 0) return [];

  const items: ResolvedJobTypeValue[] = [];
  const inputIndices: number[] = Array.from({ length: stateJobPairs.length });
  const outputIndices = new Map<number, number>();

  for (let i = 0; i < stateJobPairs.length; i++) {
    const [initialJob, currentJob] = stateJobPairs[i];
    const effectiveJob = currentJob ?? initialJob;
    inputIndices[i] = items.length;
    items.push({ typeName: initialJob.typeName, direction: "input", value: initialJob.input });
    if (effectiveJob.status === "completed") {
      outputIndices.set(i, items.length);
      items.push({
        typeName: effectiveJob.typeName,
        direction: "output",
        value: effectiveJob.output,
      });
    }
  }

  const decoded = await jobTypes.decode(items);

  return stateJobPairs.map(([initialJob, currentJob], i) => {
    const effectiveJob = currentJob ?? initialJob;
    const base = {
      id: initialJob.id,
      typeName: initialJob.chainTypeName,
      input: decoded[inputIndices[i]],
      createdAt: initialJob.createdAt,
    };

    switch (effectiveJob.status) {
      case "completed":
        return {
          ...base,
          status: "completed",
          output: decoded[outputIndices.get(i)!],
          completedAt: effectiveJob.completedAt!,
        };
      case "running":
        return { ...base, status: "running" };
      case "blocked":
        return { ...base, status: "blocked" };
      case "pending":
        return { ...base, status: "pending" };
    }
  });
};
