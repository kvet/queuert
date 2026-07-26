import { type AnyChain, type Chain, mapStatePairsToChains } from "../entities/chain.js";
import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { createStateChains } from "./create-state-jobs.js";

type ChainInput = {
  typeName: string;
  id?: string;
  input: unknown;
  blockers?: AnyChain[];
  deduplication?: DeduplicationOptions<string>;
  schedule?: ScheduleOptions;
};

export const createChains = async (
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

  const results = await createStateChains(helpers, {
    chains: chains.map((chain) => ({
      typeName: chain.typeName,
      id: chain.id,
      chainTypeName: chain.typeName,
      input: chain.input,
      blockers: chain.blockers,
      deduplication: chain.deduplication,
      schedule: chain.schedule,
    })),
    txCtx,
    transactionHooks,
  });

  const pairs: [StateJob, StateJob | undefined][] = results.map((r) => [r.job, undefined]);
  const chainsOut = await mapStatePairsToChains(pairs, helpers.jobTypes);
  return chainsOut.map((chain, i) => ({ ...chain, deduplicated: results[i].deduplicated }));
};
