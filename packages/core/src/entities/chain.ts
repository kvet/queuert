import { type StateJob } from "../state-adapter/state-adapter.js";
import { type AnyChain, type ChainStatus } from "./chain.types.js";

export type * from "./chain.types.js";

export const deriveStatus = (
  effectiveJob: Pick<StateJob, "completedAt" | "continuedToId">,
): ChainStatus =>
  effectiveJob.completedAt !== null && effectiveJob.continuedToId === null
    ? "completed"
    : "running";

export const mapStatePairToChain = (stateJobPair: [StateJob, StateJob | undefined]): AnyChain => {
  const [initialJob, currentJob] = stateJobPair;
  const effectiveJob = currentJob ?? initialJob;

  const base = {
    id: initialJob.id,
    typeName: initialJob.chainTypeName,
    input: initialJob.input,
    createdAt: initialJob.createdAt,
  };

  if (deriveStatus(effectiveJob) === "completed") {
    return {
      ...base,
      status: "completed",
      output: effectiveJob.output,
      completedAt: effectiveJob.completedAt!,
    };
  }
  return { ...base, status: "running" };
};
