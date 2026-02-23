import { randomUUID } from "node:crypto";
import { type Client, helpersSymbol } from "./client.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import { type BackoffConfig } from "./helpers/backoff.js";
import { type ParallelExecutor, createParallelExecutor } from "./helpers/parallel-executor.js";
import { raceWithSleep } from "./helpers/sleep.js";
import {
  type TransactionContext,
  createTransactionContext,
} from "./helpers/transaction-context.js";
import { withRetry } from "./internal.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Helpers } from "./setup-helpers.js";
import {
  type BaseTxContext,
  type StateAdapter,
  type StateJob,
} from "./state-adapter/state-adapter.js";
import {
  type AttemptHandlerFn,
  type JobAttemptMiddleware,
  type LeaseConfig,
  runJobProcess,
} from "./worker/job-process.js";

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
  helpers,
  typeNames,
  processors,
  defaultRetryConfig,
  defaultLeaseConfig,
  workerId,
  attemptMiddlewares,
}: {
  helpers: Helpers;
  typeNames: string[];
  processors: InProcessWorkerProcessors<any, any>;
  defaultRetryConfig: BackoffConfig;
  defaultLeaseConfig: LeaseConfig;
  workerId: string;
  attemptMiddlewares: JobAttemptMiddleware<any, any>[] | undefined;
}): Promise<
  { job: null; hasMore: false } | { job: StateJob; hasMore: boolean; execute: () => Promise<void> }
> => {
  const prepareTransactionContext = await createTransactionContext(
    helpers.stateAdapter.runInTransaction,
  );

  let job: StateJob | undefined;
  let hasMore: boolean;
  try {
    ({ job, hasMore } = await prepareTransactionContext.run(async (txCtx) =>
      helpers.stateAdapter.acquireJob({
        txCtx,
        typeNames,
      }),
    ));
  } catch (error) {
    await prepareTransactionContext.reject(error);
    throw error;
  }

  if (!job) {
    await prepareTransactionContext.resolve();
    return { job: null, hasMore: false };
  }

  const processor = processors[job.typeName];
  if (!processor) {
    const error = new Error(`No attempt handler registered for job type "${job.typeName}"`);
    await prepareTransactionContext.reject(error);
    throw error;
  }

  return {
    job,
    hasMore,
    execute: async () => {
      try {
        await runJobProcess({
          helpers,
          attemptHandler: processor.attemptHandler as any,
          job,
          prepareTransactionContext: prepareTransactionContext as TransactionContext<BaseTxContext>,
          retryConfig: processor.retryConfig ?? defaultRetryConfig,
          leaseConfig: processor.leaseConfig ?? defaultLeaseConfig,
          workerId,
          attemptMiddlewares: attemptMiddlewares as any[],
        });
      } catch (error) {
        await prepareTransactionContext.reject(error);
        throw error;
      }
    },
  };
};

export const createInProcessWorker = async <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
>({
  client,
  workerId = randomUUID(),
  concurrency,
  retryConfig,
  processDefaults,
  processors,
}: {
  client: Client<TJobTypeDefinitions, TStateAdapter>;
  workerId?: string;
  concurrency?: number;
  retryConfig?: BackoffConfig;
  processDefaults?: InProcessWorkerProcessDefaults<TStateAdapter, TJobTypeDefinitions>;
  processors: InProcessWorkerProcessors<TStateAdapter, TJobTypeDefinitions>;
}) => {
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
    start: async (): Promise<() => Promise<void>> => {
      const helpers = client[helpersSymbol];
      const { stateAdapter, notifyAdapter, observabilityHelper } = helpers;

      observabilityHelper.workerStarted({ workerId, jobTypeNames: typeNames });
      observabilityHelper.jobTypeIdleChange(concurrency ?? 1, workerId, typeNames);

      const stopController = new AbortController();
      const executor = createParallelExecutor(concurrency ?? 1);
      const jobIdsInProgress = new Set<string>();

      const runWorkerLoop = async () => {
        while (true) {
          try {
            while (executor.idleSlots() > 0) {
              const result = await performJob({
                helpers,
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
                  observabilityHelper.jobTypeProcessingChange(1, result.job, workerId);
                  observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
                  try {
                    await result.execute();
                  } catch (error) {
                    observabilityHelper.workerError({ workerId }, error);
                  } finally {
                    jobIdsInProgress.delete(result.job.id);
                    observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);
                    observabilityHelper.jobTypeProcessingChange(-1, result.job, workerId);
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
        observabilityHelper.jobTypeIdleChange(-(concurrency ?? 1), workerId, typeNames);
        observabilityHelper.workerStopped({ workerId });
      };
    },
  };
};

export type InProcessWorker = ReturnType<typeof createInProcessWorker>;
