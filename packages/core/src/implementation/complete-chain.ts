import { JobNotFoundError } from "../errors.js";
import { bufferNotifyChainCompletion, bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type FinishResult } from "./attempt-outcome.js";
import { bufferJobCompletedEvents } from "./job-completed-events.js";

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

  const [completed] = await helpers.stateAdapter.completeJobs({
    txCtx,
    completedBy: workerId,
    jobs: [{ jobId: job.id, output: parsedOutput }],
  });
  if (!completed) {
    throw new JobNotFoundError(`Job ${job.id} not found or already completed`, { jobId: job.id });
  }
  const { chain } = completed;

  bufferJobCompletedEvents(helpers, {
    completedJob: completed,
    output: parsedOutput,
    continuation: null,
    transactionHooks,
  });
  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.chainCompleted(chain, { output: parsedOutput });
    helpers.observabilityHelper.chainDuration(chain);
  });
  bufferNotifyChainCompletion(transactionHooks, helpers.notifyAdapter, completed);

  if (!completed.hasBlockedJobs) return { job: completed, continuation: null };

  const dependentJobs = await helpers.stateAdapter.unblockJobs({
    txCtx,
    blockedByChainId: chain.id,
  });

  for (const dependentJob of dependentJobs) {
    if (dependentJob.traceContext === null) continue;
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.completeBlockerSpan({
        traceContext: dependentJob.traceContext!,
        blockerChainTypeName: chain.typeName,
      });
    });
  }

  const unblockedJobs = new Map<string, StateJob>();
  for (const dependentJob of dependentJobs) {
    if (dependentJob.job.status !== "pending") continue;
    unblockedJobs.set(dependentJob.job.id, dependentJob.job);
  }

  for (const stateJob of unblockedJobs.values()) {
    bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, stateJob);
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.jobUnblocked(stateJob, { unblockedByChain: chain });
    });
  }

  return { job: completed, continuation: null };
};
