import { type AnyChain } from "../entities/chain.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type FinishResult } from "./attempt-outcome.js";
import { continueStateJobs } from "./create-state-jobs.js";
import { bufferJobCompletedEvents } from "./job-completed-events.js";

/** Runtime shape of a `continueWith` outcome, erased of the job-type generics. */
export type AnyContinueWith = {
  typeName: string;
  id?: string;
  input: unknown;
  schedule?: ScheduleOptions;
  blockers?: AnyChain[];
};

/**
 * Commits the `{ continueWith }` outcome: one adapter call inserts the successor and
 * completes `fromJob` pointing at it.
 *
 * @param options.fromJob - Predecessor being continued. The worker passes a copy carrying
 * the live attempt span's trace contexts.
 */
export const continueChain = async (
  helpers: Helpers,
  {
    fromJob,
    continueWith,
    txCtx,
    transactionHooks,
    workerId,
  }: {
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

  const { completedJob, continuation } = await continueStateJobs(helpers, {
    job: {
      typeName: continueWith.typeName,
      id: continueWith.id,
      input: continueWith.input,
      blockers: continueWith.blockers,
      schedule: continueWith.schedule,
    },
    fromJob,
    workerId,
    txCtx,
    transactionHooks,
  });

  bufferJobCompletedEvents(helpers, {
    completedJob,
    output: null,
    continuation,
    transactionHooks,
  });

  return { job: completedJob, continuation };
};
