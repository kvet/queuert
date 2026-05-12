import { type StateJob } from "../state-adapter/state-adapter.js";
import { type Chain } from "./chain.types.js";

export type * from "./chain.types.js";

export const mapStatePairToChain = (
  stateJobPair: [StateJob, StateJob | undefined],
): Chain<any, any, any, any> => {
  const [initialJob, currentJob] = stateJobPair;
  const effectiveJob = currentJob ?? initialJob;

  const base = {
    id: initialJob.id,
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
    case "pending":
      return { ...base, status: "pending" };
  }
};
