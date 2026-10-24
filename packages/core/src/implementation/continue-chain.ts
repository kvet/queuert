import { type AnyNewJob } from "../job-types/job-types.resolvers.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type StateAttemptFence,
  type StateJob,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type FinishResult } from "./attempt-outcome.js";
import { continueStateJob } from "./create-state-jobs.js";
import { bufferJobCompletedEvents } from "./job-completed-events.js";

export const continueChain = async (
  helpers: Helpers,
  {
    fromJob,
    continueWith,
    txCtx,
    transactionHooks,
    fence,
  }: {
    fromJob: StateJob;
    continueWith: AnyNewJob;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    fence: StateAttemptFence | null;
  },
): Promise<FinishResult> => {
  helpers.jobTypes.validateContinueWith(fromJob.typeName, {
    typeName: continueWith.typeName,
    input: continueWith.input,
  });

  const { completedJob, continuation } = await continueStateJob(helpers, {
    job: {
      typeName: continueWith.typeName,
      id: continueWith.id,
      input: continueWith.input,
      blockers: continueWith.blockers,
      schedule: continueWith.schedule,
    },
    fromJob,
    fence,
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
