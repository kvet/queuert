import { type Chain, mapStatePairToChain } from "../entities/chain.js";
import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { createStateJobs } from "./create-state-jobs.js";

type ChainInput = {
  typeName: string;
  input: unknown;
  blockers?: Chain<any, any, any, any>[];
  deduplication?: DeduplicationOptions<string>;
  schedule?: ScheduleOptions;
};

export const startChains = async (
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
): Promise<(Chain<string, string, unknown, unknown> & { deduplicated: boolean })[]> => {
  if (chains.length === 0) return [];

  for (const chain of chains) {
    helpers.jobTypes.validateEntry(chain.typeName);
  }

  const results = await createStateJobs(helpers, {
    jobs: chains.map((chain) => ({
      typeName: chain.typeName,
      chainTypeName: chain.typeName,
      input: chain.input,
      blockers: chain.blockers,
      deduplication: chain.deduplication,
      schedule: chain.schedule,
    })),
    txCtx,
    transactionHooks,
  });

  return results.map((r) => ({
    ...mapStatePairToChain([r.job, undefined]),
    deduplicated: r.deduplicated,
  }));
};
