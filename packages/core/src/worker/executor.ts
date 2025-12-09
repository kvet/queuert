import { randomUUID } from "node:crypto";
import { JobChain } from "../entities/job-chain.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { sleep } from "../helpers/timers.js";
import { Log } from "../log.js";
import { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { EnqueueBlockerJobChains, LeaseExpiredError, ProcessHelper } from "../queuert-helper.js";
import { BaseStateProviderContext, StateProvider } from "../state-provider/state-provider.js";
import { JobHandler, LeaseConfig, processJobHandler, RetryConfig } from "./job-handler.js";

export type RegisteredQueues = Map<
  string,
  {
    enqueueBlockerJobChains?: EnqueueBlockerJobChains<
      StateProvider<BaseStateProviderContext>,
      BaseQueueDefinitions,
      string,
      readonly JobChain<string, any, any>[]
    >;
    handler: JobHandler<
      StateProvider<BaseStateProviderContext>,
      BaseQueueDefinitions,
      string,
      readonly JobChain<string, any, any>[]
    >;
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
  retryConfig?: RetryConfig;
  leaseConfig?: LeaseConfig;
}) => Promise<() => Promise<void>>) => {
  const queueNames = Array.from(registeredQueues.keys());
  return async ({
    workerId = randomUUID(),
    pollIntervalMs = 60_000,
    nextJobDelayMs = 0,
    retryConfig = {},
    leaseConfig = {},
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

    const performWorkIteration = async () => {
      // TODO: make robust against crashes
      while (true) {
        await helper.removeExpiredJobLease({
          queueNames,
          workerId,
        });

        const pullDelayMs = await helper.getNextJobAvailableInMs({
          queueNames,
          pollIntervalMs,
        });

        // TODO: messy
        if (stopController.signal.aborted) {
          return;
        }
        const notifyController = new AbortController();
        const onStop = () => {
          notifyController.abort();
        };
        stopController.signal.addEventListener("abort", onStop);
        await Promise.any([
          notifyAdapter
            .listenJobScheduled(queueNames, {
              signal: notifyController.signal,
            })
            .catch(() => {}),
          sleep(pullDelayMs, {
            jitterMs: pullDelayMs / 10,
            signal: notifyController.signal,
          }).catch(() => {}),
        ]);
        stopController.signal.removeEventListener("abort", onStop);
        notifyController.abort();
        if (stopController.signal.aborted) {
          return;
        }

        try {
          while (
            await (async () => {
              let finalizePromise: () => Promise<void> = () => Promise.resolve();

              const claimPromise = await helper.runInTransaction(async (context) => {
                let job = await helper.acquireJob({
                  queueNames,
                  context,
                  workerId,
                });
                if (!job) {
                  return false;
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
                  async () => {
                    job = await helper.scheduleBlockerJobChains({
                      job: job!,
                      enqueueBlockerJobChains: queue.enqueueBlockerJobChains,
                      context,
                    });

                    if (job.status === "waiting") {
                      return true;
                    }

                    finalizePromise = await processJobHandler({
                      helper,
                      handler: queue.handler,
                      context,
                      job,
                      retryConfig,
                      leaseConfig,
                      workerId,
                    });

                    return true;
                  },
                );
              });

              await finalizePromise();

              return claimPromise;
            })()
          ) {
            // NOTE: prevent tight loop if there are many jobs
            await sleep(nextJobDelayMs, {
              jitterMs: nextJobDelayMs / 10,
              signal: stopController.signal,
            }).catch(() => {});
            if (stopController.signal.aborted) {
              return;
            }
          }
        } catch (error) {
          if (error instanceof LeaseExpiredError) {
            // empty
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
          }
          await sleep(pollIntervalMs * 10, {
            jitterMs: pollIntervalMs,
            signal: stopController.signal,
          }).catch(() => {});
          if (stopController.signal.aborted) {
            return;
          }
        }
      }
    };

    const performWorkIterationPromise = performWorkIteration();

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
      await performWorkIterationPromise;
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
