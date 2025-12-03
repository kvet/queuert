import { randomUUID } from "node:crypto";
import { JobChain } from "../entities/job-chain.js";
import { BaseQueueDefinitions } from "../entities/queue.js";
import { sleep } from "../helpers/timers.js";
import { Log } from "../log.js";
import { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import {
  EnqueueDependencyJobChains,
  ProcessHelper,
} from "../queuert-helper.js";
import {
  BaseStateProviderContext,
  StateProvider,
} from "../state-provider/state-provider.js";
import { JobHandler, processJobHandler } from "./job-handler.js";

export type RegisteredQueues = Map<
  string,
  {
    enqueueDependencyJobChains?: EnqueueDependencyJobChains<
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
}) => Promise<() => Promise<void>>) => {
  const queueNames = Array.from(registeredQueues.keys());
  return async ({
    workerId = randomUUID(),
    pollIntervalMs = 60_000,
    nextJobDelayMs = 0,
  } = {}) => {
    const stopController = new AbortController();
    const performWorkIteration = async () => {
      while (true) {
        await helper.removeExpiredJobClaims({
          queueNames,
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
              let finalizePromise: () => Promise<void> = () =>
                Promise.resolve();

              const claimPromise = await helper.runInTransaction(
                async (context) => {
                  let job = await helper.acquireJob({
                    queueNames,
                    context,
                  });
                  if (!job) {
                    return false;
                  }

                  const queue = registeredQueues.get(job.queueName);
                  if (!queue) {
                    throw new Error(
                      `No handler registered for queue "${job.queueName}"`
                    );
                  }

                  log({
                    level: "info",
                    message: `Processing job`,
                    args: [
                      {
                        jobId: job.id,
                        queueName: job.queueName,
                        status: job.status,
                      },
                    ],
                  });

                  return helper.withParentJobContext(job.id, async () => {
                    job = await helper.scheduleDependentJobChains({
                      job: job!,
                      enqueueDependencyJobChains:
                        queue.enqueueDependencyJobChains,
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
                      pollIntervalMs,
                      workerId,
                    });

                    return true;
                  });
                }
              );

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
