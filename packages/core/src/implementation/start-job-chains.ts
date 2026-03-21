import { type JobChain, mapStateJobPairToJobChain } from "../entities/job-chain.js";
import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext } from "../state-adapter/state-adapter.js";
import { createStateJobs } from "./create-state-jobs.js";

type JobChainInput = {
  typeName: string;
  input: unknown;
  blockers?: JobChain<any, any, any, any>[];
  deduplication?: DeduplicationOptions;
  schedule?: ScheduleOptions;
};

export const startJobChains = async (
  helpers: Helpers,
  {
    jobChains,
    txCtx,
    transactionHooks,
  }: {
    jobChains: JobChainInput[];
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<(JobChain<string, string, unknown, unknown> & { deduplicated: boolean })[]> => {
  if (jobChains.length === 0) return [];

  for (const jobChain of jobChains) {
    helpers.jobTypeRegistry.validateEntry(jobChain.typeName);
  }

  const results = await createStateJobs(helpers, {
    jobs: jobChains.map((jobChain) => ({
      typeName: jobChain.typeName,
      chainTypeName: jobChain.typeName,
      chainIndex: 0,
      input: jobChain.input,
      blockers: jobChain.blockers,
      isChainStart: true,
      deduplication: jobChain.deduplication,
      schedule: jobChain.schedule,
    })),
    txCtx,
    transactionHooks,
  });

  return results.map((r) => ({
    ...mapStateJobPairToJobChain([r.job, undefined]),
    deduplicated: r.deduplicated,
  }));
};
