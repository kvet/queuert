import { JobNotFoundError } from "../errors.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { bufferJobCompletedEvents } from "./job-completed-events.js";

/**
 * Writes the completion row that ends a chain and emits the job-level events
 * that describe it.
 */
export const completeJob = async (
  helpers: Helpers,
  {
    job,
    txCtx,
    transactionHooks,
    workerId,
    output,
  }: {
    job: StateJob;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    workerId: string | null;
    output: unknown;
  },
): Promise<StateJob & { hasBlockedJobs: boolean }> => {
  const [completed] = await helpers.stateAdapter.completeJobs({
    txCtx,
    completedBy: workerId,
    jobs: [{ jobId: job.id, output }],
  });

  // The caller holds the job's row, so a hole here means it was completed or deleted
  // out from under a lock the adapter never took.
  if (!completed) {
    throw new JobNotFoundError(`Job ${job.id} not found or already completed`, { jobId: job.id });
  }

  bufferJobCompletedEvents(helpers, {
    completedJob: completed,
    output,
    continuation: null,
    transactionHooks,
  });

  return completed;
};
