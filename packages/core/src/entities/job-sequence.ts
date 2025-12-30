import { StateJob } from "../state-adapter/state-adapter.js";
import { JobSequence } from "./job-sequence.types.js";

export * from "./job-sequence.types.js";

export const mapStateJobPairToJobSequence = (
  stateJobPair: [StateJob, StateJob | undefined],
): JobSequence<any, any, any> => {
  const [firstJob, currentJob] = stateJobPair;
  const effectiveJob = currentJob ?? firstJob;

  const base = {
    id: firstJob.id,
    originId: firstJob.originId,
    rootId: firstJob.rootId,
    firstJobTypeName: firstJob.typeName,
    input: firstJob.input,
    createdAt: firstJob.createdAt,
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
