import { type ScheduleOptions } from "../entities/schedule.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
  RescheduleJobError,
} from "../errors.js";
import { type BackoffConfig, calculateBackoffMs } from "../helpers/backoff.js";
import { bufferObservabilityEvent } from "../helpers/observability-hooks.js";
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

  const isRescheduled = error instanceof RescheduleJobError;
  const schedule: ScheduleOptions = isRescheduled
    ? error.schedule
    : { afterMs: calculateBackoffMs(job.attempt, backoffConfig) };
  const errorString = isRescheduled ? String(error.cause) : String(error);

  bufferObservabilityEvent(transactionHooks, () => {
    helpers.observabilityHelper.jobAttemptFailed(job, {
      workerId,
      rescheduledSchedule: schedule,
      error,
    });
  });

  await helpers.stateAdapter.rescheduleJob({
    txCtx,
    jobId: job.id,
    schedule,
    error: errorString,
  });

  return { schedule };
};
