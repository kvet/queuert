import { type JobChain, mapStateJobPairToJobChain } from "../entities/job-chain.js";
import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext } from "../state-adapter/state-adapter.js";
import { createStateJobs } from "./create-state-jobs.js";

type ChainInput = {
  typeName: string;
  input: unknown;
  blockers?: JobChain<any, any, any, any>[];
  deduplication?: DeduplicationOptions;
  schedule?: ScheduleOptions;
};

export const startJobChains = async (
  helpers: Helpers,
  {
    chains,
    txCtx,
    transactionHooks,
  }: {
    chains: ChainInput[];
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<(JobChain<string, string, unknown, unknown> & { deduplicated: boolean })[]> => {
  if (chains.length === 0) return [];

  for (const chain of chains) {
    helpers.registry.validateEntry(chain.typeName);
  }

  const results = await createStateJobs(helpers, {
    jobs: chains.map((chain) => ({
      typeName: chain.typeName,
      chainTypeName: chain.typeName,
      chainIndex: 0,
      input: chain.input,
      blockers: chain.blockers,
      isChainStart: true,
      deduplication: chain.deduplication,
      schedule: chain.schedule,
    })),
    txCtx,
    transactionHooks,
  });

  return results.map((r) => ({
    ...mapStateJobPairToJobChain([r.job, undefined]),
    deduplicated: r.deduplicated,
  }));
};
