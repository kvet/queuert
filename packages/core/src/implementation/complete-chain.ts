import { ChainNotFoundError } from "../errors.js";
import { bufferNotifyChainCompletion, bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type FinishResult } from "./attempt-outcome.js";
import { finishJobAttempt } from "./finish-job-attempt.js";

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

  const completedJob = await finishJobAttempt(helpers, {
    job,
    txCtx,
    transactionHooks,
    workerId,
    outcome: { output: parsedOutput },
  });

  const [headJob] = await helpers.stateAdapter.getJobs({
    txCtx,
    jobIds: [completedJob.chainId],
  });

  if (!headJob) {
    throw new ChainNotFoundError(`Chain with id ${completedJob.chainId} not found`, {
      chainId: completedJob.chainId,
    });
  }

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.chainCompleted(headJob, { output: parsedOutput });
    helpers.observabilityHelper.chainDuration(headJob, completedJob);
  });
  bufferNotifyChainCompletion(transactionHooks, helpers.notifyAdapter, completedJob);

  const { unblockedJobs, blockerTraceContexts } = await helpers.stateAdapter.unblockJobs({
    txCtx,
    blockedByChainId: headJob.id,
  });
  for (const traceContext of blockerTraceContexts) {
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.completeBlockerSpan({
        traceContext,
        blockerChainTypeName: headJob.chainTypeName,
      });
    });
  }

  unblockedJobs.forEach((unblockedJob) => {
    bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, unblockedJob);
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.jobUnblocked(unblockedJob, {
        unblockedByChain: headJob,
      });
    });
  });

  return { job: completedJob, continuation: null };
};
