import { type StateJob } from "../state-adapter/state-adapter.js";
import { type JobChain } from "./job-chain.types.js";

export * from "./job-chain.types.js";

export const mapStateJobPairToJobChain = (
  stateJobPair: [StateJob, StateJob | undefined],
): JobChain<any, any, any, any> => {
  const [initialJob, currentJob] = stateJobPair;
  const effectiveJob = currentJob ?? initialJob;

  const base = {
    id: initialJob.id,
    originId: initialJob.originId,
    rootChainId: initialJob.rootChainId,
    typeName: initialJob.chainTypeName,
    input: initialJob.input,
    createdAt: initialJob.createdAt,
  };

  switch (effectiveJob.status) {
    case "completed":
      return {
        ...base,
        status: "completed",
        output: effectiveJob.output,
        completedAt: effectiveJob.completedAt!,
      };
    case "running":
      return { ...base, status: "running" };
    case "blocked":
      return { ...base, status: "blocked" };
    case "pending":
      return { ...base, status: "pending" };
  }
};
