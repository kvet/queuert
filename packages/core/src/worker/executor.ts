import { randomUUID } from "node:crypto";
import { BaseJobTypeDefinitions } from "../entities/job-type.js";
import { BackoffConfig } from "../helpers/backoff.js";
import { withRetry } from "../helpers/retry.js";
import { sleep } from "../helpers/sleep.js";
import {
  JobAlreadyCompletedError,
  JobTakenByAnotherWorkerError,
  ProcessHelper,
} from "../queuert-helper.js";
import { BaseStateAdapterContext, StateAdapter } from "../state-adapter/state-adapter.js";
import { JobProcessFn, LeaseConfig, runJobProcess } from "./job-process.js";

export type RegisteredJobTypes = Map<
  string,
  {
    process: JobProcessFn<
      StateAdapter<BaseStateAdapterContext, any>,
      BaseJobTypeDefinitions,
      string
    >;
    retryConfig?: BackoffConfig;
    leaseConfig?: LeaseConfig;
  }
>;

export const createExecutor = ({
  helper,
  registeredJobTypes,
}: {
  helper: ProcessHelper;
  registeredJobTypes: RegisteredJobTypes;
}): ((startOptions?: {
  workerId?: string;
  pollIntervalMs?: number;
  nextJobDelayMs?: number;
  defaultRetryConfig?: BackoffConfig;
  defaultLeaseConfig?: LeaseConfig;
  workerLoopRetryConfig?: BackoffConfig;
}) => Promise<() => Promise<void>>) => {
  const typeNames = Array.from(registeredJobTypes.keys());
  const { notifyAdapter, logHelper } = helper;

  return async ({
    workerId = randomUUID(),
    pollIntervalMs = 60_000,
    nextJobDelayMs = 0,
    defaultRetryConfig = {
      initialDelayMs: 10_000,
      multiplier: 2.0,
      maxDelayMs: 300_000,
    },
    defaultLeaseConfig = {
      leaseMs: 60_000,
      renewIntervalMs: 30_000,
    },
    workerLoopRetryConfig = {
      initialDelayMs: 10_000,
      multiplier: 2.0,
      maxDelayMs: 300_000,
    },
  } = {}) => {
    logHelper.workerStarted({ workerId, jobTypeNames: typeNames });

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
        await Promise.any([
          notified,
          sleep(pullDelayMs, {
            jitterMs: pullDelayMs / 10,
            signal: stopController.signal,
          }),
        ]);
      } finally {
        await dispose();
      }
    };

    const performJob = async (): Promise<boolean> => {
      try {
        const [hasMore, continueProcessing] = await helper.runInTransaction(
          async (context): Promise<[boolean, (() => Promise<void>) | undefined]> => {
            let job = await helper.acquireJob({
              typeNames,
              context,
              workerId,
            });
            if (!job) {
              return [false, undefined];
            }

            const jobType = registeredJobTypes.get(job.typeName);
            if (!jobType) {
              throw new Error(`No process function registered for job type "${job.typeName}"`);
            }

            return helper.withJobContext(
              {
                sequenceId: job.sequenceId,
                sequenceTypeName: job.sequenceTypeName,
                rootSequenceId: job.rootSequenceId,
                originId: job.id,
              },
              async () => [
                true,
                await runJobProcess({
                  helper,
                  process: jobType.process,
                  context,
                  job,
                  retryConfig: jobType.retryConfig ?? defaultRetryConfig,
                  leaseConfig: jobType.leaseConfig ?? defaultLeaseConfig,
                  workerId,
                  notifyAdapter,
                }),
              ],
            );
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
          logHelper.workerError({ workerId }, error);
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
          logHelper.workerError({ workerId }, error);
          throw error;
        }
      }
    };

    const runWorkerLoopPromise = withRetry(async () => runWorkerLoop(), workerLoopRetryConfig, {
      signal: stopController.signal,
    }).catch(() => {});

    return async () => {
      logHelper.workerStopping({ workerId });
      stopController.abort();
      await runWorkerLoopPromise;
      logHelper.workerStopped({ workerId });
    };
  };
};

export type Executor = ReturnType<typeof createExecutor>;
