import { randomUUID } from "node:crypto";
import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import { type BackoffConfig } from "./helpers/backoff.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { withRetry } from "./internal.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { type Helper, helper } from "./helper.js";
import { type StateAdapter, type StateJob } from "./state-adapter/state-adapter.js";
import {
  type AttemptHandlerFn,
  type JobAttemptMiddleware,
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
import { setupHelpers } from "./setup-helpers.js";

export type InProcessWorkerProcessDefaults<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  /** How often to poll for new jobs in milliseconds */
  pollIntervalMs?: number;
  /** Retry configuration for failed job attempts */
  retryConfig?: BackoffConfig;
  /** Lease configuration for job ownership */
  leaseConfig?: LeaseConfig;
  /** Middlewares that wrap each job attempt */
  attemptMiddlewares?: JobAttemptMiddleware<TStateAdapter, TJobTypeDefinitions>[];
};

export type InProcessWorkerProcessor<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  /** Handler function called for each job attempt */
  attemptHandler: AttemptHandlerFn<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
  /** Per-job-type retry configuration (overrides processDefaults) */
  retryConfig?: BackoffConfig;
  /** Per-job-type lease configuration (overrides processDefaults) */
  leaseConfig?: LeaseConfig;
};

export type InProcessWorkerProcessors<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  [K in keyof TJobTypeDefinitions & string]?: InProcessWorkerProcessor<
    TStateAdapter,
    TJobTypeDefinitions,
    K
  >;
};

export type InProcessWorker = {
  start: () => Promise<() => Promise<void>>;
};

const waitForNextJob = async ({
  stateAdapter,
  notifyAdapter,
  typeNames,
  pollIntervalMs,
  executor,
  signal,
}: {
  stateAdapter: StateAdapter<any, any>;
  notifyAdapter: NotifyAdapter;
  typeNames: string[];
  pollIntervalMs: number;
  executor: ParallelExecutor<any>;
  signal: AbortSignal;
}): Promise<void> => {
  const { promise: notified, resolve: onNotification } = Promise.withResolvers<void>();
  let disposeNotified: () => Promise<void> = async () => {};
  try {
    if (executor.idleSlots() > 0) {
      disposeNotified = await notifyAdapter.listenJobScheduled(typeNames, () => {
        onNotification();
      });
    }
  } catch {}
  const { promise: slotAvailable, resolve: onSlotAvailable } = Promise.withResolvers<void>();
  const disposeSlotAvailable = executor.onIdleSlot(onSlotAvailable);
  try {
    const nextJobAvailableInMs = await stateAdapter.getNextJobAvailableInMs({
      typeNames,
    });
    const pullDelayMs =
      nextJobAvailableInMs !== null
        ? Math.min(Math.max(0, nextJobAvailableInMs), pollIntervalMs)
        : pollIntervalMs;

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
  stateAdapter,
  typeNames,
  processors,
  defaultRetryConfig,
  defaultLeaseConfig,
  workerId,
  attemptMiddlewares,
}: {
  helper: Helper; // TODO: remove
  stateAdapter: StateAdapter<any, any>;
  typeNames: string[];
  processors: InProcessWorkerProcessors<any, any>;
  defaultRetryConfig: BackoffConfig;
  defaultLeaseConfig: LeaseConfig;
  workerId: string;
  attemptMiddlewares: JobAttemptMiddleware<any, any>[] | undefined;
}): Promise<
  { job: null; hasMore: false } | { job: StateJob; hasMore: boolean; execute: () => Promise<void> }
> => {
  const signal = createSignal<{ job: StateJob | null; hasMore: boolean }>();

  const grabJobPromise = stateAdapter.runInTransaction(
    async (txContext): Promise<() => Promise<void>> => {
      const { job, hasMore } = await stateAdapter.acquireJob({
        txContext,
        typeNames,
      });

      if (!job) {
        return async () => {};
      }

      const processor = processors[job.typeName];
      if (!processor) {
        throw new Error(`No attempt handler registered for job type "${job.typeName}"`);
      }

      signal.signalOnce({ job, hasMore });

      const run = await runJobProcess({
        helper,
        attemptHandler: processor.attemptHandler as any,
        txContext,
        job,
        retryConfig: processor.retryConfig ?? defaultRetryConfig,
        leaseConfig: processor.leaseConfig ?? defaultLeaseConfig,
        workerId,
        attemptMiddlewares: attemptMiddlewares as any[],
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

export const createInProcessWorker = async <
  TJobTypeRegistry extends JobTypeRegistry<any>,
  TStateAdapter extends StateAdapter<any, any>,
>({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  registry: registryOption,
  log,
  workerId = randomUUID(),
  concurrency,
  retryConfig,
  processDefaults,
  processors,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  registry: TJobTypeRegistry;
  log?: Log;
  workerId?: string;
  concurrency?: number;
  retryConfig?: BackoffConfig;
  processDefaults?: InProcessWorkerProcessDefaults<TStateAdapter, TJobTypeRegistry["$definitions"]>;
  processors: InProcessWorkerProcessors<TStateAdapter, TJobTypeRegistry["$definitions"]>;
}): Promise<InProcessWorker> => {
  const typeNames = Array.from(Object.keys(processors));

  const pollIntervalMs = processDefaults?.pollIntervalMs ?? 60_000;
  const defaultRetryConfig = processDefaults?.retryConfig ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const defaultLeaseConfig = processDefaults?.leaseConfig ?? {
    leaseMs: 60_000,
    renewIntervalMs: 30_000,
  };
  const workerRetryConfig = retryConfig ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const attemptMiddlewares = processDefaults?.attemptMiddlewares;

  return {
    start: async () => {
      const { stateAdapter, notifyAdapter, observabilityHelper } = setupHelpers({
        stateAdapter: stateAdapterOption,
        notifyAdapter: notifyAdapterOption,
        observabilityAdapter: observabilityAdapterOption,
        registry: registryOption,
        log,
      });

      observabilityHelper.workerStarted({ workerId, jobTypeNames: typeNames });
      observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);

      const stopController = new AbortController();
      const executor = createParallelExecutor(concurrency ?? 1);
      const jobIdsInProgress = new Set<string>();

      const runWorkerLoop = async () => {
        while (true) {
          try {
            while (executor.idleSlots() > 0) {
              const result = await performJob({
                helper: helper({
                  stateAdapter: stateAdapterOption,
                  notifyAdapter: notifyAdapterOption,
                  observabilityAdapter: observabilityAdapterOption,
                  registry: registryOption,
                  log,
                }),
                stateAdapter,
                typeNames,
                processors,
                defaultRetryConfig,
                defaultLeaseConfig,
                workerId,
                attemptMiddlewares,
              });

              if (result.job) {
                jobIdsInProgress.add(result.job.id);
                void executor.add(async () => {
                  try {
                    await result.execute();
                  } catch (error) {
                    observabilityHelper.workerError({ workerId }, error);
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
              const reaped = await stateAdapter.removeExpiredJobLease({
                typeNames,
                ignoredJobIds: Array.from(jobIdsInProgress),
              });
              if (reaped) {
                observabilityHelper.jobReaped(reaped, { workerId });

                try {
                  await notifyAdapter.notifyJobScheduled(reaped.typeName, 1);
                } catch {}
                try {
                  await notifyAdapter.notifyJobOwnershipLost(reaped.id);
                } catch {}
              }

              if (stopController.signal.aborted) {
                return;
              }

              if (reaped) {
                continue;
              }
            }

            await waitForNextJob({
              stateAdapter,
              notifyAdapter,
              typeNames,
              pollIntervalMs,
              executor,
              signal: stopController.signal,
            });
            if (stopController.signal.aborted) {
              return;
            }
          } catch (error) {
            observabilityHelper.workerError({ workerId }, error);
            throw error;
          }
        }
      };

      const runWorkerLoopPromise = withRetry(async () => runWorkerLoop(), workerRetryConfig, {
        signal: stopController.signal,
      }).catch(() => {});

      return async () => {
        observabilityHelper.workerStopping({ workerId });
        stopController.abort();
        await runWorkerLoopPromise;
        await executor.drain();
        observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
        observabilityHelper.workerStopped({ workerId });
      };
    },
  };
};
