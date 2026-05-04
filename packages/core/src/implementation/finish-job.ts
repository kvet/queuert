import { type Job } from "../entities/job.js";
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
    ...rest
  }: {
    job: StateJob;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    workerId: string | null;
  } & (
    | { type: "completeChain"; output: unknown }
    | { type: "continueWith"; continuedJob: Job<any, any, any, any, any> }
  ),
): Promise<StateJob> => {
  const hasContinuedJob = rest.type === "continueWith";
  let storedOutput: unknown = null;

  if (!hasContinuedJob) {
    const [encoded] = await helpers.jobTypes.encode([
      { typeName: job.typeName, direction: "output", value: rest.output },
    ]);
    storedOutput = encoded;
  }

  job = await helpers.stateAdapter.completeJob({
    txCtx,
    jobId: job.id,
    output: storedOutput,
    workerId,
  });

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobCompleted(job, {
      output: storedOutput,
      continuedWith: hasContinuedJob ? rest.continuedJob : undefined,
      workerId,
    });
    helpers.observabilityHelper.jobDuration(job);
  });

  if (workerId === null) {
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.completeJobSpan(job, {
        continued: hasContinuedJob ? rest.continuedJob : undefined,
        chainCompleted: !hasContinuedJob,
      });
    });
  }

  if (!hasContinuedJob) {
    const chainStartJob = await helpers.stateAdapter.getJob({
      txCtx,
      jobId: job.chainId,
    });

    if (!chainStartJob) {
      throw new ChainNotFoundError(`Chain with id ${job.chainId} not found`, {
        chainId: job.chainId,
      });
    }

    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.chainCompleted(chainStartJob, { output: storedOutput });
      helpers.observabilityHelper.chainDuration(chainStartJob, job);
    });
    bufferNotifyChainCompletion(transactionHooks, helpers.notifyAdapter, job);

    const { unblockedJobs, blockerTraceContexts } = await helpers.stateAdapter.unblockJobs({
      txCtx,
      blockedByChainId: chainStartJob.id,
    });
    for (const traceContext of blockerTraceContexts) {
      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.completeBlockerSpan({
          traceContext,
          blockerChainTypeName: chainStartJob.chainTypeName,
        });
      });
    }

    if (unblockedJobs.length > 0) {
      unblockedJobs.forEach((unblockedJob) => {
        bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, unblockedJob);
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobUnblocked(unblockedJob, {
            unblockedByChain: chainStartJob,
          });
        });
      });
    }
  }

  return job;
};
