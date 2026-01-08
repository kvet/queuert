import { StateJob } from "../state-adapter/state-adapter.js";
import { JobSequence } from "./job-sequence.types.js";

export * from "./job-sequence.types.js";

export const mapStateJobPairToJobSequence = (
  stateJobPair: [StateJob, StateJob | undefined],
): JobSequence<any, any, any, any> => {
  const [initialJob, currentJob] = stateJobPair;
  const effectiveJob = currentJob ?? initialJob;

  const base = {
    id: initialJob.id,
    originId: initialJob.originId,
    rootSequenceId: initialJob.rootSequenceId,
    typeName: initialJob.sequenceTypeName,
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
