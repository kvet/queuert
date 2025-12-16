import { randomUUID } from "node:crypto";
import { JobSequence } from "../entities/job-sequence.js";
import { BaseJobTypeDefinitions } from "../entities/job-type.js";
import { BackoffConfig } from "../helpers/backoff.js";
import { withRetry } from "../helpers/retry.js";
import { sleep } from "../helpers/sleep.js";
import { Log } from "../log.js";
import { NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { LeaseExpiredError, ProcessHelper, StartBlockers } from "../queuert-helper.js";
import { StateAdapter } from "../state-adapter/state-adapter.js";
import { BaseStateProviderContext } from "../state-provider/state-provider.js";
import { JobHandler, LeaseConfig, processJobHandler } from "./job-handler.js";

export type RegisteredJobTypes = Map<
  string,
  {
    startBlockers?: StartBlockers<
      StateAdapter<BaseStateProviderContext>,
      BaseJobTypeDefinitions,
      string,
      readonly JobSequence<string, any, any>[]
    >;
    handler: JobHandler<
      StateAdapter<BaseStateProviderContext>,
      BaseJobTypeDefinitions,
      string,
      readonly JobSequence<string, any, any>[]
    >;
    retryConfig?: BackoffConfig;
    leaseConfig?: LeaseConfig;
  }
>;

export const createExecutor = ({
  helper,
  notifyAdapter,
  log,
  registeredJobTypes,
}: {
  helper: ProcessHelper;
  notifyAdapter: NotifyAdapter;
  log: Log;
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
          jobTypeNames: typeNames,
        },
      ],
    });

    const stopController = new AbortController();

    const waitForNextJob = async () => {
      const pullDelayMs = await helper.getNextJobAvailableInMs({
        typeNames,
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
        notifyAdapter.listenJobScheduled(typeNames, {
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
              typeNames,
              context,
              workerId,
            });
            if (!job) {
              return [false, undefined];
            }

            const jobType = registeredJobTypes.get(job.typeName);
            if (!jobType) {
              throw new Error(`No handler registered for job type "${job.typeName}"`);
            }

            return helper.withJobContext(
              {
                rootId: job.rootId,
                sequenceId: job.sequenceId,
                originId: job.id,
              },
              async (): Promise<[boolean, (() => Promise<void>) | undefined]> => {
                job = await helper.scheduleBlockerJobSequences({
                  job: job!,
                  startBlockers: jobType.startBlockers,
                  context,
                });

                if (job.status === "blocked") {
                  return [true, undefined];
                }

                return [
                  true,
                  await processJobHandler({
                    helper,
                    handler: jobType.handler,
                    context,
                    job,
                    retryConfig: jobType.retryConfig ?? defaultRetryConfig,
                    leaseConfig: jobType.leaseConfig ?? defaultLeaseConfig,
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
