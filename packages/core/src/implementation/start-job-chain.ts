import { type JobChain, mapStateJobPairToJobChain } from "../entities/job-chain.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type CommitHooks } from "../commit-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type DeduplicationOptions } from "../state-adapter/state-adapter.js";
import { createStateJob } from "./create-state-job.js";

export const startJobChain = async <TChainTypeName extends string, TInput, TOutput>(
  helpers: Helpers,
  {
    typeName,
    input,
    txCtx,
    commitHooks,
    deduplication,
    schedule,
    blockers,
  }: {
    typeName: TChainTypeName;
    input: TInput;
    txCtx: any;
    commitHooks: CommitHooks;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
    blockers?: JobChain<any, any, any, any>[];
  },
): Promise<JobChain<string, TChainTypeName, TInput, TOutput> & { deduplicated: boolean }> => {
  const { job, deduplicated } = await createStateJob(helpers, {
    typeName,
    input,
    txCtx,
    commitHooks,
    blockers,
    isChain: true,
    chainIndex: 0,
    deduplication,
    schedule,
  });

  return { ...mapStateJobPairToJobChain([job, undefined]), deduplicated };
};
