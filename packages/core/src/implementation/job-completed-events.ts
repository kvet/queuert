import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type StateJob, type StateJobInfo } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

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
