import { randomUUID } from "node:crypto";
import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import { type BackoffConfig } from "./helpers/backoff.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { withRetry } from "./internal.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { type QueuertHelper, queuertHelper } from "./queuert-helper.js";
import { type StateAdapter, type StateJob } from "./state-adapter/state-adapter.js";
import {
  type JobAttemptMiddleware,
  type JobProcessFn,
  type LeaseConfig,
  runJobProcess,
} from "./worker/job-process.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTakenByAnotherWorkerError,
} from "./errors.js";
import { type ParallelExecutor, createParallelExecutor } from "./helpers/parallel-executor.js";
import { createSignal } from "./helpers/signal.js";

export type InProcessWorkerProcessingConfig<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  pollIntervalMs?: number;
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
  executor,
  signal,
}: {
  helper: QueuertHelper;
  typeNames: string[];
  pollIntervalMs: number;
  executor: ParallelExecutor<any>;
  signal: AbortSignal;
}): Promise<void> => {
  const { promise: notified, resolve: onNotification } = Promise.withResolvers<void>();
  let disposeNotified: () => Promise<void> = async () => {};
  try {
    if (executor.idleSlots() > 0) {
      disposeNotified = await helper.notifyAdapter.listenJobScheduled(typeNames, () => {
        onNotification();
      });
    }
  } catch {}
  const { promise: slotAvailable, resolve: onSlotAvailable } = Promise.withResolvers<void>();
  const disposeSlotAvailable = executor.onIdleSlot(onSlotAvailable);
  try {
    const pullDelayMs = await helper.getNextJobAvailableInMs({
      typeNames,
      pollIntervalMs,
    });

    if (signal.aborted) {
      return;
    }
    await raceWithSleep(Promise.race([slotAvailable, notified]), pullDelayMs, {
      jitterMs: pullDelayMs / 10,
      signal,
    });
  } finally {
    await disposeNotified();
    disposeSlotAvailable();
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
  helper: QueuertHelper;
  typeNames: string[];
  jobTypeProcessors: InProcessWorkerJobTypeProcessors<any, any>;
  defaultRetryConfig: BackoffConfig;
  defaultLeaseConfig: LeaseConfig;
  workerId: string;
  jobAttemptMiddlewares: JobAttemptMiddleware<any, any>[] | undefined;
}): Promise<
  { job: null; hasMore: false } | { job: StateJob; hasMore: boolean; execute: () => Promise<void> }
> => {
  const signal = createSignal<{ job: StateJob | null; hasMore: boolean }>();

  const grabJobPromise = helper.stateAdapter.runInTransaction(
    async (txContext): Promise<() => Promise<void>> => {
      const { job, hasMore } = await helper.stateAdapter.acquireJob({
        txContext,
        typeNames,
      });

      if (!job) {
        return async () => {};
      }

      const jobType = jobTypeProcessors[job.typeName];
      if (!jobType) {
        throw new Error(`No process function registered for job type "${job.typeName}"`);
      }

      signal.signalOnce({ job, hasMore });

      const run = await runJobProcess({
        helper,
        process: jobType.process as any,
        txContext,
        job,
        retryConfig: jobType.retryConfig ?? defaultRetryConfig,
        leaseConfig: jobType.leaseConfig ?? defaultLeaseConfig,
        workerId,
        jobAttemptMiddlewares: jobAttemptMiddlewares as any[],
        typeNames,
      });

      return async () => {
        try {
          await run();
        } catch (error) {
          if (
            error instanceof JobTakenByAnotherWorkerError ||
            error instanceof JobAlreadyCompletedError ||
            error instanceof JobNotFoundError
          ) {
            return;
          } else {
            throw error;
          }
        }
      };
    },
  );

  const winner = await Promise.race([signal.onSignal, grabJobPromise]);

  if (typeof winner === "object" && "job" in winner && "hasMore" in winner && winner.job) {
    return {
      job: winner.job,
      hasMore: winner.hasMore,
      execute: async () => (await grabJobPromise)(),
    };
  }
  return {
    job: null,
    hasMore: false,
  };
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
  concurrency,
  jobTypeProcessing,
  jobTypeProcessors,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypeRegistry: TJobTypeRegistry;
  log: Log;
  workerId?: string;
  concurrency?: {
    maxSlots: number;
  };
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
      const executor = createParallelExecutor(concurrency?.maxSlots ?? 1);
      const jobIdsInProgress = new Set<string>();

      const runWorkerLoop = async () => {
        while (true) {
          try {
            while (executor.idleSlots() > 0) {
              const result = await performJob({
                helper,
                typeNames,
                jobTypeProcessors,
                defaultRetryConfig,
                defaultLeaseConfig,
                workerId,
                jobAttemptMiddlewares,
              });

              if (result.job) {
                jobIdsInProgress.add(result.job.id);
                void executor.add(async () => {
                  try {
                    await result.execute();
                  } catch (error) {
                    helper.observabilityHelper.workerError({ workerId }, error);
                  } finally {
                    jobIdsInProgress.delete(result.job.id);
                  }
                });
              }
              if (!result.hasMore) {
                break;
              }
            }

            if (stopController.signal.aborted) {
              return;
            }

            if (executor.idleSlots() > 0) {
              const reaped = await helper.removeExpiredJobLease({
                typeNames,
                workerId,
                ignoredJobIds: Array.from(jobIdsInProgress),
              });

              if (stopController.signal.aborted) {
                return;
              }

              if (reaped) {
                continue;
              }
            }

            await waitForNextJob({
              helper,
              typeNames,
              pollIntervalMs,
              executor,
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
        await executor.drain();
        helper.observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
        helper.observabilityHelper.workerStopped({ workerId });
      };
    },
  };
};
