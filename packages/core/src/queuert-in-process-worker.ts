import { randomUUID } from "node:crypto";
import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import { type BackoffConfig } from "./helpers/backoff.js";
import { raceWithSleep, sleep } from "./helpers/sleep.js";
import { withRetry } from "./internal.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { type ProcessHelper, queuertHelper } from "./queuert-helper.js";
import { type StateAdapter } from "./state-adapter/state-adapter.js";
import {
  type JobAttemptMiddleware,
  type JobProcessFn,
  type LeaseConfig,
  runJobProcess,
} from "./worker/job-process.js";
import { JobAlreadyCompletedError, JobTakenByAnotherWorkerError } from "./errors.js";

export type InProcessWorkerProcessingConfig<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  pollIntervalMs?: number;
  nextJobDelayMs?: number;
  defaultRetryConfig?: BackoffConfig;
  defaultLeaseConfig?: LeaseConfig;
  workerLoopRetryConfig?: BackoffConfig;
  jobAttemptMiddlewares?: JobAttemptMiddleware<TStateAdapter, TJobTypeDefinitions>[];
};

export type InProcessWorkerJobTypeProcessor<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  process: JobProcessFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
  retryConfig?: BackoffConfig;
  leaseConfig?: LeaseConfig;
};

export type InProcessWorkerJobTypeProcessors<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  [K in keyof TJobTypeDefinitions & string]?: InProcessWorkerJobTypeProcessor<
    TStateAdapter,
    TJobTypeDefinitions,
    K
  >;
};

export type QueuertInProcessWorker = {
  start: () => Promise<() => Promise<void>>;
};

const waitForNextJob = async ({
  helper,
  typeNames,
  pollIntervalMs,
  signal,
}: {
  helper: ProcessHelper;
  typeNames: string[];
  pollIntervalMs: number;
  signal: AbortSignal;
}): Promise<void> => {
  const { promise: notified, resolve: onNotification } = Promise.withResolvers<void>();
  let dispose: () => Promise<void> = async () => {};
  try {
    dispose = await helper.notifyAdapter.listenJobScheduled(typeNames, () => {
      onNotification();
    });
  } catch {}
  try {
    const pullDelayMs = await helper.getNextJobAvailableInMs({
      typeNames,
      pollIntervalMs,
    });

    if (signal.aborted) {
      return;
    }
    await raceWithSleep(notified, pullDelayMs, {
      jitterMs: pullDelayMs / 10,
      signal,
    });
  } finally {
    await dispose();
  }
};

const performJob = async ({
  helper,
  typeNames,
  jobTypeProcessors,
  defaultRetryConfig,
  defaultLeaseConfig,
  workerId,
  jobAttemptMiddlewares,
}: {
  helper: ProcessHelper;
  typeNames: string[];
  jobTypeProcessors: InProcessWorkerJobTypeProcessors<any, any>;
  defaultRetryConfig: BackoffConfig;
  defaultLeaseConfig: LeaseConfig;
  workerId: string;
  jobAttemptMiddlewares: JobAttemptMiddleware<any, any>[] | undefined;
}): Promise<boolean> => {
  try {
    const [hasMore, continueProcessing] = await helper.stateAdapter.runInTransaction(
      async (txContext): Promise<[boolean, (() => Promise<void>) | undefined]> => {
        const { job, hasMore } = await helper.stateAdapter.acquireJob({
          txContext,
          typeNames,
        });
        if (!job) {
          return [false, undefined];
        }

        const jobType = jobTypeProcessors[job.typeName];
        if (!jobType) {
          throw new Error(`No process function registered for job type "${job.typeName}"`);
        }

        return [
          hasMore,
          await runJobProcess({
            helper,
            process: jobType.process as any,
            txContext,
            job,
            retryConfig: jobType.retryConfig ?? defaultRetryConfig,
            leaseConfig: jobType.leaseConfig ?? defaultLeaseConfig,
            workerId,
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
      helper.observabilityHelper.workerError({ workerId }, error);
      throw error;
    }
  }
};

export const createQueuertInProcessWorker = async <
  TJobTypeRegistry extends JobTypeRegistry<any>,
  TStateAdapter extends StateAdapter<any, any>,
>({
  stateAdapter,
  notifyAdapter,
  observabilityAdapter,
  jobTypeRegistry,
  log,
  workerId = randomUUID(),
  jobTypeProcessing,
  jobTypeProcessors,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypeRegistry: TJobTypeRegistry;
  log: Log;
  workerId?: string;
  jobTypeProcessing?: InProcessWorkerProcessingConfig<
    TStateAdapter,
    TJobTypeRegistry["$definitions"]
  >;
  jobTypeProcessors: InProcessWorkerJobTypeProcessors<
    TStateAdapter,
    TJobTypeRegistry["$definitions"]
  >;
}): Promise<QueuertInProcessWorker> => {
  const typeNames = Array.from(Object.keys(jobTypeProcessors));

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

  return {
    start: async () => {
      const helper = queuertHelper({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        jobTypeRegistry,
        log,
      });
      helper.observabilityHelper.workerStarted({ workerId, jobTypeNames: typeNames });
      helper.observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);

      const stopController = new AbortController();

      const runWorkerLoop = async () => {
        while (true) {
          try {
            while (true) {
              const hasMore = await performJob({
                helper,
                typeNames,
                jobTypeProcessors,
                defaultRetryConfig,
                defaultLeaseConfig,
                workerId,
                jobAttemptMiddlewares,
              });
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

            await helper.removeExpiredJobLease({
              typeNames,
              workerId,
            });

            await waitForNextJob({
              helper,
              typeNames,
              pollIntervalMs,
              signal: stopController.signal,
            });
            if (stopController.signal.aborted) {
              return;
            }
          } catch (error) {
            helper.observabilityHelper.workerError({ workerId }, error);
            throw error;
          }
        }
      };

      const runWorkerLoopPromise = withRetry(async () => runWorkerLoop(), workerLoopRetryConfig, {
        signal: stopController.signal,
      }).catch(() => {});

      return async () => {
        helper.observabilityHelper.workerStopping({ workerId });
        stopController.abort();
        await runWorkerLoopPromise;
        helper.observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
        helper.observabilityHelper.workerStopped({ workerId });
      };
    },
  };
};
