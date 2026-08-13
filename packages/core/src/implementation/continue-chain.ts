import { type AnyChain } from "../entities/chain.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type FinishResult } from "./attempt-outcome.js";
import { continueStateJob } from "./create-state-jobs.js";
import { finishJobAttempt } from "./finish-job-attempt.js";

/** Runtime shape of a `continueWith` outcome, erased of the job-type generics. */
export type AnyContinueWith = {
  typeName: string;
  id?: string;
  input: unknown;
  schedule?: ScheduleOptions;
  blockers?: AnyChain[];
};

/**
 * Commits the `{ continueWith }` outcome: the successor is inserted first so the
 * completion can point at it, which also puts its `job_created` event ahead of
 * the predecessor's completion events.
 *
 * @param options.fromJob - Predecessor row handed to the successor. The worker
 * passes a copy carrying the live attempt span's trace contexts.
 */
export const continueChain = async (
  helpers: Helpers,
  {
    job,
    fromJob,
    continueWith,
    txCtx,
    transactionHooks,
    workerId,
  }: {
    job: StateJob;
    fromJob: StateJob;
    continueWith: AnyContinueWith;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    workerId: string | null;
  },
): Promise<FinishResult> => {
  helpers.jobTypes.validateContinueWith(fromJob.typeName, {
    typeName: continueWith.typeName,
    input: continueWith.input,
  });

  const { job: continuation } = await continueStateJob(helpers, {
    job: {
      typeName: continueWith.typeName,
      id: continueWith.id,
      input: continueWith.input,
      blockers: continueWith.blockers,
      schedule: continueWith.schedule,
    },
    fromJob,
    txCtx,
    transactionHooks,
  });

  const completedJob = await finishJobAttempt(helpers, {
    job,
    txCtx,
    transactionHooks,
    workerId,
    outcome: { continuation },
  });

  return { job: completedJob, continuation };
};
