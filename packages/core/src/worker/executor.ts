import { randomUUID } from "node:crypto";
import { JobChain } from "../entities/job-chain.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { BackoffConfig } from "../helpers/backoff.js";
import { withRetry } from "../helpers/retry.js";
import { sleep } from "../helpers/sleep.js";
import { Log } from "../log.js";
import { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { EnqueueBlockerJobChains, LeaseExpiredError, ProcessHelper } from "../queuert-helper.js";
import { StateAdapter } from "../state-adapter/state-adapter.js";
import { BaseStateProviderContext } from "../state-provider/state-provider.js";
import { JobHandler, LeaseConfig, processJobHandler } from "./job-handler.js";

export type RegisteredQueues = Map<
  string,
  {
    enqueueBlockerJobChains?: EnqueueBlockerJobChains<
      StateAdapter<BaseStateProviderContext>,
      BaseQueueDefinitions,
      string,
      readonly JobChain<string, any, any>[]
    >;
    handler: JobHandler<
      StateAdapter<BaseStateProviderContext>,
      BaseQueueDefinitions,
      string,
      readonly JobChain<string, any, any>[]
    >;
    retryConfig?: BackoffConfig;
    leaseConfig?: LeaseConfig;
  }
>;

export const createExecutor = ({
  helper,
  notifyAdapter,
  log,
  registeredQueues,
}: {
  helper: ProcessHelper;
  notifyAdapter: NotifyAdapter;
  log: Log;
  registeredQueues: RegisteredQueues;
}): ((startOptions?: {
  workerId?: string;
  pollIntervalMs?: number;
  nextJobDelayMs?: number;
  defaultRetryConfig?: BackoffConfig;
  defaultLeaseConfig?: LeaseConfig;
  workerLoopRetryConfig?: BackoffConfig;
}) => Promise<() => Promise<void>>) => {
  const queueNames = Array.from(registeredQueues.keys());
  return async ({
    workerId = randomUUID(),
    pollIntervalMs = 60_000,
    nextJobDelayMs = 0,
    defaultRetryConfig = {
      initialDelayMs: 1_000,
      multiplier: 2.0,
      maxDelayMs: 60_000,
    },
    defaultLeaseConfig = {
      leaseMs: 30_000,
      renewIntervalMs: 10_000,
    },
    workerLoopRetryConfig = {
      initialDelayMs: 10_000,
      multiplier: 2.0,
      maxDelayMs: 300_000,
    },
  } = {}) => {
    log({
      type: "worker_started",
      level: "info",
      message: "Started worker",
      args: [
        {
          workerId,
          queueNames,
        },
      ],
    });

    const stopController = new AbortController();

    const waitForNextJob = async () => {
      const pullDelayMs = await helper.getNextJobAvailableInMs({
        queueNames,
        pollIntervalMs,
      });

      if (stopController.signal.aborted) {
        return;
      }
      const notifyController = new AbortController();
      const onStop = () => {
        notifyController.abort();
      };
      stopController.signal.addEventListener("abort", onStop);
      await Promise.any([
        notifyAdapter.listenJobScheduled(queueNames, {
          signal: notifyController.signal,
        }),
        sleep(pullDelayMs, {
          jitterMs: pullDelayMs / 10,
          signal: notifyController.signal,
        }),
      ]);
      stopController.signal.removeEventListener("abort", onStop);
      notifyController.abort();
    };

    const performJob = async (): Promise<boolean> => {
      try {
        const [hasMore, finalize] = await helper.runInTransaction(
          async (context): Promise<[boolean, (() => Promise<void>) | undefined]> => {
            let job = await helper.acquireJob({
              queueNames,
              context,
              workerId,
            });
            if (!job) {
              return [false, undefined];
            }

            const queue = registeredQueues.get(job.queueName);
            if (!queue) {
              throw new Error(`No handler registered for queue "${job.queueName}"`);
            }

            return helper.withJobContext(
              {
                rootId: job.rootId,
                chainId: job.chainId,
                originId: job.id,
              },
              async (): Promise<[boolean, (() => Promise<void>) | undefined]> => {
                job = await helper.scheduleBlockerJobChains({
                  job: job!,
                  enqueueBlockerJobChains: queue.enqueueBlockerJobChains,
                  context,
                });

                if (job.status === "blocked") {
                  return [true, undefined];
                }

                return [
                  true,
                  await processJobHandler({
                    helper,
                    handler: queue.handler,
                    context,
                    job,
                    retryConfig: queue.retryConfig ?? defaultRetryConfig,
                    leaseConfig: queue.leaseConfig ?? defaultLeaseConfig,
                    workerId,
                  }),
                ];
              },
            );
          },
        );

        await finalize?.();

        return hasMore;
      } catch (error) {
        if (error instanceof LeaseExpiredError) {
          return true;
        } else {
          log({
            type: "worker_error",
            level: "error",
            message: "Worker error",
            args: [
              {
                workerId,
              },
              error,
            ],
          });
          throw error;
        }
      }
    };

    const runWorkerLoop = async () => {
      while (true) {
        try {
          await helper.removeExpiredJobLease({
            queueNames,
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
          log({
            type: "worker_error",
            level: "error",
            message: "Worker error",
            args: [
              {
                workerId,
              },
              error,
            ],
          });
          throw error;
        }
      }
    };

    const runWorkerLoopPromise = withRetry(() => runWorkerLoop(), workerLoopRetryConfig, {
      signal: stopController.signal,
    }).catch(() => {});

    return async () => {
      log({
        type: "worker_stopping",
        level: "info",
        message: "Stopping worker...",
        args: [
          {
            workerId,
          },
        ],
      });
      stopController.abort();
      await runWorkerLoopPromise;
      log({
        type: "worker_stopped",
        level: "info",
        message: "Worker has been stopped",
        args: [
          {
            workerId,
          },
        ],
      });
    };
  };
};

export type Executor = ReturnType<typeof createExecutor>;
