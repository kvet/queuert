import { type Job } from "../entities/job.js";
import { JobNotFoundError } from "../errors.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { bufferNotifyChainCompletion, bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import {
  bufferObservabilityEvent,
  rollbackObservabilityBuffer,
  snapshotObservabilityBuffer,
} from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";

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
    | { type: "continueWith"; continuedJob: Job<any, any, any, any> }
  ),
): Promise<StateJob> => {
  const hasContinuedJob = rest.type === "continueWith";
  let output = hasContinuedJob ? null : rest.output;

  if (!hasContinuedJob) {
    output = helpers.registry.parseOutput(job.typeName, output);
  }

  job = await helpers.stateAdapter.completeJob({
    txCtx,
    jobId: job.id,
    output,
    workerId,
  });

  const observabilitySnapshot = snapshotObservabilityBuffer(transactionHooks);
  try {
    bufferObservabilityEvent(transactionHooks, () => {
      helpers.observabilityHelper.jobCompleted(job, {
        output,
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
      const jobChainStartJob = await helpers.stateAdapter.getJobById({
        txCtx,
        jobId: job.chainId,
      });

      if (!jobChainStartJob) {
        throw new JobNotFoundError(`Job chain with id ${job.chainId} not found`);
      }

      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.jobChainCompleted(jobChainStartJob, { output });
        helpers.observabilityHelper.jobChainDuration(jobChainStartJob, job);
      });
      bufferNotifyChainCompletion(transactionHooks, helpers.notifyAdapter, job);

      const { unblockedJobs, blockerTraceContexts } =
        await helpers.stateAdapter.scheduleBlockedJobs({
          txCtx,
          blockedByChainId: jobChainStartJob.id,
        });
      for (const traceContext of blockerTraceContexts) {
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.completeBlockerSpan({
            traceContext,
            blockerChainTypeName: jobChainStartJob.chainTypeName,
          });
        });
      }

      if (unblockedJobs.length > 0) {
        unblockedJobs.forEach((unblockedJob) => {
          bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, unblockedJob);
          bufferObservabilityEvent(transactionHooks, () => {
            helpers.observabilityHelper.jobUnblocked(unblockedJob, {
              unblockedByChain: jobChainStartJob,
            });
          });
        });
      }
    }

    return job;
  } catch (error) {
    rollbackObservabilityBuffer(transactionHooks, observabilitySnapshot);
    throw error;
  }
};
