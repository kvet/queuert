import { type AnyJob } from "../entities/job.js";
import { ChainNotFoundError } from "../errors.js";
import { bufferNotifyChainCompletion, bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

export const finishJob = async (
  helpers: Helpers,
  {
    job,
    txCtx,
    transactionHooks,
    workerId,
    output: terminalOutput,
    continuedJob,
  }: {
    job: StateJob;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    workerId: string | null;
    output?: unknown;
    continuedJob?: AnyJob | null;
  },
): Promise<StateJob> => {
  const hasContinuedJob = continuedJob != null;
  const output = continuedJob ? null : helpers.jobTypes.parseOutput(job.typeName, terminalOutput);

  job = await helpers.stateAdapter.finishJobAttempt({
    txCtx,
    jobId: job.id,
    workerId,
    outcome: continuedJob ? { continuedToId: continuedJob.id } : { output },
  });

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobCompleted(job, {
      output,
      continuedWith: continuedJob ?? undefined,
      workerId,
    });
    helpers.observabilityHelper.jobDuration(job);
  });

  if (workerId === null) {
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.completeJobSpan(job, {
        continuedWith: continuedJob ?? undefined,
        chainCompleted: !hasContinuedJob,
      });
    });
  }

  if (!hasContinuedJob) {
    const [headJob] = await helpers.stateAdapter.getJobs({
      txCtx,
      jobIds: [job.chainId],
    });

    if (!headJob) {
      throw new ChainNotFoundError(`Chain with id ${job.chainId} not found`, {
        chainId: job.chainId,
      });
    }

    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.chainCompleted(headJob, { output });
      helpers.observabilityHelper.chainDuration(headJob, job);
    });
    bufferNotifyChainCompletion(transactionHooks, helpers.notifyAdapter, job);

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

    if (unblockedJobs.length > 0) {
      unblockedJobs.forEach((unblockedJob) => {
        bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, unblockedJob);
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobUnblocked(unblockedJob, {
            unblockedByChain: headJob,
          });
        });
      });
    }
  }

  return job;
};
