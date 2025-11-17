import {
  BaseDbProviderContext,
  QueuertDbProvider,
} from "../db-provider/db-provider.js";
import { BaseChainDefinitions } from "../entities/chain.js";
import { JobChain } from "../entities/job_chain.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { sleep } from "../helpers/timers.js";
import { Log } from "../log.js";
import { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import {
  ProcessHelper,
  ResolveEnqueueDependencyJobChains,
} from "../process-helper.js";
import { JobHandler, processJobHandler } from "./job-handler.js";

export type RegisteredQueues = Map<
  string,
  {
    enqueueDependencyJobChains?: ResolveEnqueueDependencyJobChains<
      QueuertDbProvider<BaseDbProviderContext>,
      BaseChainDefinitions,
      string,
      BaseQueueDefinitions,
      string,
      readonly JobChain<string, any, any>[]
    >;
    handler: JobHandler<
      QueuertDbProvider<BaseDbProviderContext>,
      BaseChainDefinitions,
      string,
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
  pollIntervalMs?: number;
  nextJobDelayMs?: number;
}) => Promise<() => Promise<void>>) => {
  return async ({ pollIntervalMs = 60_000, nextJobDelayMs = 0 } = {}) => {
    const stopController = new AbortController();
    const performWorkIteration = async () => {
      while (true) {
        const pullDelayMs = await helper.getNextJobAvailableAt({
          queueNames: Array.from(registeredQueues.keys()),
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
            .listenJobScheduled([...registeredQueues.keys()], {
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
              let finalizePromise: Promise<void> = Promise.resolve();

              const claimPromise = await helper.runInTransaction(
                async (context) => {
                  let job = await helper.getJobToProcess({
                    queueNames: Array.from(registeredQueues.keys()),
                    context,
                  });
                  if (!job) {
                    return false;
                  }

                  const queue = registeredQueues.get(job.queue_name);
                  if (!queue) {
                    throw new Error(
                      `No handler registered for queue "${job.queue_name}"`
                    );
                  }

                  log({
                    level: "info",
                    message: `Processing job`,
                    args: [
                      {
                        jobId: job.id,
                        queueName: job.queue_name,
                        status: job.status,
                      },
                    ],
                  });

                  job = await helper.scheduleDependentJobChainsSql({
                    job,
                    enqueueDependencyJobChains:
                      queue.enqueueDependencyJobChains,
                    context,
                  });

                  if (job.status === "waiting") {
                    return true;
                  }

                  const startExecution = await processJobHandler({
                    helper,
                    handler: queue.handler,
                    context,
                    job,
                    pollIntervalMs,
                  });

                  finalizePromise = startExecution.execute;
                  return true;
                }
              );

              await finalizePromise;

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
          log({
            level: "error",
            message: "Worker iteration failed",
            args: [error],
          });
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
        level: "info",
        message: "Stopping worker...",
        args: [],
      });
      stopController.abort();
      await performWorkIterationPromise;
      log({
        level: "info",
        message: "Worker has been stopped",
        args: [],
      });
    };
  };
};

export type Executor = ReturnType<typeof createExecutor>;
