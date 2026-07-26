import { type AnyChain } from "../entities/chain.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type ResolvedJob } from "../entities/job-types.resolvers.js";
import { mapStateJobsToJobs } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type Helpers } from "../setup-helpers.js";
import { type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { continueStateJob } from "./create-state-jobs.js";

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
    blockers?: AnyChain[];
    fromJob: StateJob;
  },
): Promise<ResolvedJob<string, BaseJobTypeDefinitions, TJobTypeName, string>> => {
  helpers.jobTypes.validateContinueWith(fromJob.typeName, { typeName, input });

  const { job } = await continueStateJob(helpers, {
    job: {
      typeName,
      id,
      input,
      blockers,
      schedule,
    },
    fromJob,
    txCtx,
    transactionHooks,
  });

  const [mapped] = await mapStateJobsToJobs([job], helpers.jobTypes);
  return mapped as ResolvedJob<string, BaseJobTypeDefinitions, TJobTypeName, string>;
};
