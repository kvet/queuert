import { randomUUID } from "node:crypto";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { JobAlreadyCompletedError, JobTakenByAnotherWorkerError } from "../errors.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { withRetry } from "../helpers/retry.js";
import { raceWithSleep, sleep } from "../helpers/sleep.js";
import { type ProcessHelper } from "../queuert-helper.js";
import { type InProcessWorkerProcessingConfig } from "../queuert-in-process-worker.js";
import { type BaseTxContext, type StateAdapter } from "../state-adapter/state-adapter.js";
import { type JobProcessFn, type LeaseConfig, runJobProcess } from "./job-process.js";

export type RegisteredJobTypes = Map<
  string,
  {
    process: JobProcessFn<StateAdapter<BaseTxContext, any>, BaseJobTypeDefinitions, string>;
    retryConfig?: BackoffConfig;
    leaseConfig?: LeaseConfig;
  }
>;

export const createExecutor = <
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
>({
  helper,
  registeredJobTypes,
  workerId: configuredWorkerId,
  jobTypeProcessing,
}: {
  helper: ProcessHelper;
  registeredJobTypes: RegisteredJobTypes;
  workerId?: string;
  jobTypeProcessing?: InProcessWorkerProcessingConfig<TStateAdapter, TJobTypeDefinitions>;
}): (() => Promise<() => Promise<void>>) => {
  const typeNames = Array.from(registeredJobTypes.keys());
  const { notifyAdapter, observabilityHelper } = helper;

  const workerId = configuredWorkerId ?? randomUUID();
  const pollIntervalMs = jobTypeProcessing?.pollIntervalMs ?? 60_000;
  const nextJobDelayMs = jobTypeProcessing?.nextJobDelayMs ?? 0;
  const defaultRetryConfig = jobTypeProcessing?.defaultRetryConfig ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const defaultLeaseConfig = jobTypeProcessing?.defaultLeaseConfig ?? {
    leaseMs: 60_000,
    renewIntervalMs: 30_000,
  };
  const workerLoopRetryConfig = jobTypeProcessing?.workerLoopRetryConfig ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const jobAttemptMiddlewares = jobTypeProcessing?.jobAttemptMiddlewares;

  return async () => {
    observabilityHelper.workerStarted({ workerId, jobTypeNames: typeNames });
    observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);
    const stopController = new AbortController();

    const waitForNextJob = async () => {
      const { promise: notified, resolve: onNotification } = Promise.withResolvers<void>();
      let dispose: () => Promise<void> = async () => {};
      try {
        dispose = await notifyAdapter.listenJobScheduled(typeNames, () => {
          onNotification();
        });
      } catch {}
      try {
        const pullDelayMs = await helper.getNextJobAvailableInMs({
          typeNames,
          pollIntervalMs,
        });

        if (stopController.signal.aborted) {
          return;
        }
        await raceWithSleep(notified, pullDelayMs, {
          jitterMs: pullDelayMs / 10,
          signal: stopController.signal,
        });
      } finally {
        await dispose();
      }
    };

    const performJob = async (): Promise<boolean> => {
      try {
        const [hasMore, continueProcessing] = await helper.stateAdapter.runInTransaction(
          async (txContext): Promise<[boolean, (() => Promise<void>) | undefined]> => {
            let job = await helper.stateAdapter.acquireJob({
              txContext,
              typeNames,
            });
            if (!job) {
              return [false, undefined];
            }

            const jobType = registeredJobTypes.get(job.typeName);
            if (!jobType) {
              throw new Error(`No process function registered for job type "${job.typeName}"`);
            }

            return [
              true,
              await runJobProcess({
                helper,
                process: jobType.process,
                txContext,
                job,
                retryConfig: jobType.retryConfig ?? defaultRetryConfig,
                leaseConfig: jobType.leaseConfig ?? defaultLeaseConfig,
                workerId,
                notifyAdapter,
                typeNames,
                jobAttemptMiddlewares: jobAttemptMiddlewares as any[],
              }),
            ];
          },
        );

        await continueProcessing?.();

        return hasMore;
      } catch (error) {
        if (
          error instanceof JobTakenByAnotherWorkerError ||
          error instanceof JobAlreadyCompletedError
        ) {
          return true;
        } else {
          observabilityHelper.workerError({ workerId }, error);
          throw error;
        }
      }
    };

    const runWorkerLoop = async () => {
      while (true) {
        try {
          await helper.removeExpiredJobLease({
            typeNames,
            workerId,
          });

          await waitForNextJob();
          if (stopController.signal.aborted) {
            return;
          }

          while (true) {
            const hasMore = await performJob();
            if (!hasMore) {
              break;
            }

            await sleep(nextJobDelayMs, {
              jitterMs: nextJobDelayMs / 10,
              signal: stopController.signal,
            });
            if (stopController.signal.aborted) {
              return;
            }
          }
        } catch (error) {
          observabilityHelper.workerError({ workerId }, error);
          throw error;
        }
      }
    };

    const runWorkerLoopPromise = withRetry(async () => runWorkerLoop(), workerLoopRetryConfig, {
      signal: stopController.signal,
    }).catch(() => {});

    return async () => {
      observabilityHelper.workerStopping({ workerId });
      stopController.abort();
      await runWorkerLoopPromise;
      observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
      observabilityHelper.workerStopped({ workerId });
    };
  };
};
