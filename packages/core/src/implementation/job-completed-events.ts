import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type StateJob, type StateJobInfo } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

/**
 * Buffers the job-level events shared by both chain-level outcomes. The caller
 * decides what the completion means: an output ends the chain, a continuation
 * hands it on. Attempt-level reporting belongs to whoever owns the attempt.
 */
export const bufferJobCompletedEvents = (
  helpers: Helpers,
  {
    completedJob,
    output,
    continuation,
    transactionHooks,
  }: {
    completedJob: StateJob;
    output: unknown;
    continuation: StateJobInfo | null;
    transactionHooks: TransactionHooks;
  },
): void => {
  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobCompleted(completedJob, {
      output,
      continuedWith: continuation ?? undefined,
    });
    helpers.observabilityHelper.jobDuration(completedJob);
  });
};
