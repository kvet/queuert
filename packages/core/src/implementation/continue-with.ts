import { type JobChain } from "../entities/job-chain.js";
import { type BaseJobTypeDefinitions, type JobOf } from "../entities/job-type.js";
import { mapStateJobToJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { createStateJob } from "./create-state-job.js";

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
): Promise<JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>> => {
  helpers.registry.validateContinueWith(fromTypeName, { typeName, input });

  const { job } = await createStateJob(helpers, {
    typeName,
    input,
    txCtx,
    transactionHooks,
    blockers,
    isChain: false,
    chainId,
    chainIndex,
    chainTypeName,
    originChainTraceContext,
    originTraceContext,
    schedule,
  });

  return mapStateJobToJob(job) as JobOf<string, BaseJobTypeDefinitions, TJobTypeName, string>;
};
