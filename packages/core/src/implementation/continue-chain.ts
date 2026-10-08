import { type AnyChain } from "../entities/chain.js";
import { type ScheduleOptions } from "../entities/schedule.js";
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

export type AnyContinueWith = {
  typeName: string;
  id?: string;
  input: unknown;
  schedule?: ScheduleOptions;
  blockers?: AnyChain[];
};

export const continueChain = async (
  helpers: Helpers,
  {
    fromJob,
    continueWith,
    txCtx,
    transactionHooks,
    workerId,
    fence,
  }: {
    fromJob: StateJob;
    continueWith: AnyContinueWith;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    workerId: string | null;
    fence?: StateAttemptFence;
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
    workerId,
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
