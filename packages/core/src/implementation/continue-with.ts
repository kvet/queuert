import { type JobChain } from "../entities/job-chain.js";
import { type BaseNavigationMap } from "../entities/job-type-registry.navigation.js";
import { type ResolvedJob } from "../entities/job-type-registry.resolvers.js";
import { mapStateJobToJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { createStateJobs } from "./create-state-jobs.js";

export const continueWith = async <TJobTypeName extends string, TInput>(
  helpers: Helpers,
  {
    typeName,
    input,
    txCtx,
    transactionHooks,
    schedule,
    blockers,
    chainId,
    chainIndex,
    chainTypeName,
    originChainTraceContext,
    originTraceContext,
    fromTypeName,
  }: {
    typeName: TJobTypeName;
    input: TInput;
    txCtx: any;
    transactionHooks: TransactionHooks;
    schedule?: ScheduleOptions;
    blockers?: JobChain<any, any, any, any>[];
    chainId: string;
    chainIndex: number;
    chainTypeName: string;
    originChainTraceContext: string | null;
    originTraceContext: string | null;
    fromTypeName: string;
  },
): Promise<ResolvedJob<string, BaseNavigationMap, TJobTypeName, string>> => {
  helpers.registry.validateContinueWith(fromTypeName, { typeName, input });

  const [{ job }] = await createStateJobs(helpers, {
    jobs: [
      {
        typeName,
        chainTypeName,
        chainIndex,
        input,
        blockers,
        chainId,
        isChainStart: false,
        originChainTraceContext,
        originTraceContext,
        schedule,
      },
    ],
    txCtx,
    transactionHooks,
  });

  return mapStateJobToJob(job) as ResolvedJob<string, BaseNavigationMap, TJobTypeName, string>;
};
