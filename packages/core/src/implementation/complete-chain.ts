import { bufferNotifyChainCompletion, bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type FinishResult } from "./attempt-outcome.js";
import { completeJob } from "./complete-job.js";

/**
 * Commits the `{ output }` outcome: the job carries the chain's final value, so
 * completing it ends the chain — which also means tearing the chain down, by
 * emitting its events, notifying waiters, and unblocking its dependents.
 */
export const completeChain = async (
  helpers: Helpers,
  {
    job,
    output,
    txCtx,
    transactionHooks,
    workerId,
  }: {
    job: StateJob;
    output: unknown;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    workerId: string | null;
  },
): Promise<FinishResult> => {
  const parsedOutput = helpers.jobTypes.parseOutput(job.typeName, output);

  // Completing the job ends the chain, so the adapter hands back the completed
  // chain along with whether anything is waiting on it.
  const completed = await completeJob(helpers, {
    job,
    txCtx,
    transactionHooks,
    workerId,
    output: parsedOutput,
  });
  const { chain } = completed;

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.chainCompleted(chain, { output: parsedOutput });
    helpers.observabilityHelper.chainDuration(chain);
  });
  bufferNotifyChainCompletion(transactionHooks, helpers.notifyAdapter, completed);

  if (!completed.hasBlockedJobs) return { job: completed, continuation: null };

  const unblockedResults = await helpers.stateAdapter.unblockJobs({
    txCtx,
    blockedByChainId: chain.id,
  });

  for (const blockedJob of unblockedResults) {
    if (blockedJob.traceContext === null) continue;
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.completeBlockerSpan({
        traceContext: blockedJob.traceContext!,
        blockerChainTypeName: chain.typeName,
      });
    });
  }

  // TODO!!!: WTF is seen?
  const seen = new Set<string>();
  for (const blockedJob of unblockedResults) {
    if (seen.has(blockedJob.job.id)) continue;
    seen.add(blockedJob.job.id);
    const stateJob = { ...blockedJob.job, chain };
    bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, stateJob);
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.jobUnblocked(stateJob, { unblockedByChain: chain });
    });
  }

  return { job: completed, continuation: null };
};
