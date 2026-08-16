import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

/**
 * Writes the completion row shared by both chain-level outcomes and emits the
 * job-level events that describe it. The caller decides what the completion
 * means: an output ends the chain, a continuation hands it on. Attempt-level
 * reporting belongs to whoever owns the attempt.
 */
export const finishJobAttempt = async (
  helpers: Helpers,
  {
    job,
    txCtx,
    transactionHooks,
    workerId,
    outcome,
  }: {
    job: StateJob;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    workerId: string | null;
    outcome: { output: unknown } | { continuation: StateJob };
  },
): Promise<StateJob> => {
  const continuation = "continuation" in outcome ? outcome.continuation : null;
  const output = "continuation" in outcome ? null : outcome.output;

  const completedJob = await helpers.stateAdapter.finishJobAttempt({
    txCtx,
    jobId: job.id,
    workerId,
    outcome: continuation ? { continuedToId: continuation.id } : { output },
  });

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobCompleted(completedJob, {
      output,
      continuedWith: continuation ?? undefined,
    });
    helpers.observabilityHelper.jobDuration(completedJob);
  });

  return completedJob;
};
