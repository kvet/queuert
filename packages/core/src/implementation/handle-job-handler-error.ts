import { type ScheduleOptions } from "../entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "../errors.js";
import { type BackoffConfig, calculateBackoffMs } from "../helpers/backoff.js";
import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
import { serializeError } from "../helpers/serialize-error.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

export const handleJobHandlerError = async (
  helpers: Helpers,
  {
    job,
    error,
    txCtx,
    transactionHooks,
    backoffConfig,
    workerId,
  }: {
    job: StateJob;
    error: unknown;
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
    backoffConfig: BackoffConfig;
    workerId: string;
  },
): Promise<{
  schedule?: ScheduleOptions;
}> => {
  if (
    error instanceof JobTakenByAnotherWorkerError ||
    error instanceof JobAlreadyCompletedError ||
    error instanceof JobNotFoundError
  ) {
    return {};
  }

  const schedule: ScheduleOptions = { afterMs: calculateBackoffMs(job.attempt, backoffConfig) };
  const errorString = serializeError(error);

  const rescheduledJob = await helpers.stateAdapter.finishJobAttempt({
    txCtx,
    jobId: job.id,
    workerId,
    outcome: { error: errorString, schedule },
  });

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobRescheduled(rescheduledJob);
    helpers.observabilityHelper.jobAttemptFailed(job, {
      workerId,
      error,
    });
  });

  return { schedule };
};
