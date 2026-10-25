import { type JobTypes, type ResolvedJobTypeValue } from "../job-types/job-types.js";
import {
  type StateChainInfo,
  type StateJob,
  type StateJobInfo,
} from "../state-adapter/state-adapter.js";
import { type AnyJob } from "./job.types.js";

export type * from "./job.types.js";

const hasOutput = (stateJob: StateJobInfo): boolean =>
  stateJob.status === "completed" && stateJob.continuedToId === null;

const projectJob = (
  stateJob: StateJobInfo,
  chain: StateChainInfo,
  input: unknown,
  output: unknown,
): AnyJob => {
  const base = {
    id: stateJob.id,
    chainId: stateJob.chainId,
    chainTypeName: chain.typeName,
    chainIndex: stateJob.chainIndex,
    typeName: stateJob.typeName,
    input,
    createdAt: stateJob.createdAt,
    scheduledAt: stateJob.scheduledAt,
    attempt: stateJob.attempt,
    lastAttemptAt: stateJob.lastAttemptAt,
    lastAttemptError: stateJob.lastAttemptError,
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
        output,
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

export const mapStateJobsToJobs = async (
  stateJobs: readonly (StateJob & { continuation?: StateJobInfo })[],
  jobTypes: Pick<JobTypes<any>, "decode">,
): Promise<(AnyJob & { continuedTo?: AnyJob })[]> => {
  if (stateJobs.length === 0) return [];

  const items: ResolvedJobTypeValue[] = [];
  const collect = (stateJob: StateJobInfo): void => {
    items.push({ typeName: stateJob.typeName, direction: "input", value: stateJob.input });
    if (hasOutput(stateJob)) {
      items.push({ typeName: stateJob.typeName, direction: "output", value: stateJob.output });
    }
  };
  for (const stateJob of stateJobs) {
    collect(stateJob);
    if (stateJob.continuation) collect(stateJob.continuation);
  }

  const decoded = await jobTypes.decode(items);

  let cursor = 0;
  const project = (stateJob: StateJobInfo, chain: StateChainInfo): AnyJob => {
    const input = decoded[cursor++];
    const output = hasOutput(stateJob) ? decoded[cursor++] : undefined;
    return projectJob(stateJob, chain, input, output);
  };
  return stateJobs.map((stateJob) => {
    const job = project(stateJob, stateJob.chain);
    return stateJob.continuation
      ? { ...job, continuedTo: project(stateJob.continuation, stateJob.chain) }
      : job;
  });
};
