import { type Chain } from "../entities/chain.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type ResolvedJob } from "../entities/job-types.resolvers.js";
import { mapStateJobToJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type Helpers } from "../setup-helpers.js";
import { type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { createStateJobs } from "./create-state-jobs.js";

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- TInput preserves type inference at call sites
export const continueWith = async <TJobTypeName extends string, TInput>(
  helpers: Helpers,
  {
    typeName,
    id,
    input,
    txCtx,
    transactionHooks,
    schedule,
    blockers,
    fromJob,
  }: {
    typeName: TJobTypeName;
    id?: string;
    input: TInput;
    txCtx: any;
    transactionHooks: TransactionHooks;
    schedule?: ScheduleOptions;
    blockers?: Chain<any, any, any, any>[];
    fromJob: StateJob;
  },
): Promise<ResolvedJob<string, BaseJobTypeDefinitions, TJobTypeName, string>> => {
  helpers.jobTypes.validateContinueWith(fromJob.typeName, { typeName, input });

  const [{ job }] = await createStateJobs(helpers, {
    jobs: [
      {
        typeName,
        id,
        input,
        blockers,
        fromJob,
        schedule,
      },
    ],
    txCtx,
    transactionHooks,
  });

  return mapStateJobToJob(job) as ResolvedJob<string, BaseJobTypeDefinitions, TJobTypeName, string>;
};
