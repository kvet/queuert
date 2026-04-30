import { type Chain } from "../entities/chain.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type ResolvedJob } from "../entities/job-types.resolvers.js";
import { mapStateJobToJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type Helpers } from "../setup-helpers.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { createStateJobs } from "./create-state-jobs.js";

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- TInput preserves type inference at call sites
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
    blockers?: Chain<any, any, any, any>[];
    chainId: string;
    chainIndex: number;
    chainTypeName: string;
    originChainTraceContext: string | null;
    originTraceContext: string | null;
    fromTypeName: string;
  },
): Promise<ResolvedJob<string, BaseJobTypeDefinitions, TJobTypeName, string>> => {
  helpers.jobTypes.validateContinueWith(fromTypeName, { typeName, input });

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

  return mapStateJobToJob(job) as ResolvedJob<string, BaseJobTypeDefinitions, TJobTypeName, string>;
};
