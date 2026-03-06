import { randomUUID } from "node:crypto";
import { type Client } from "./client.js";
import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import { type BackoffConfig } from "./helpers/backoff.js";
import { clientHelpersMap } from "./helpers/client-helpers-map.js";
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
  type AttemptHandler,
  type JobAttemptMiddleware,
  runJobProcess,
} from "./worker/job-process.js";
import { type LeaseConfig } from "./worker/lease.js";

/** Default configuration applied to all job types unless overridden per-processor. */
export type InProcessWorkerProcessDefaults<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> = {
  /** How often to poll for new jobs in milliseconds */
  pollIntervalMs?: number;
  /** Backoff configuration for failed job attempts */
  backoffConfig?: BackoffConfig;
  /** Lease configuration for job ownership */
  leaseConfig?: LeaseConfig;
  /** Middlewares that wrap each job attempt */
  attemptMiddlewares?: JobAttemptMiddleware<TStateAdapter, TJobTypeDefinitions>[];
};

/** Configuration for processing a single job type. */
export type InProcessWorkerProcessor<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  /** Handler function called for each job attempt */
  attemptHandler: AttemptHandler<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
  /** Per-job-type backoff configuration (overrides processDefaults) */
  backoffConfig?: BackoffConfig;
  /** Per-job-type lease configuration (overrides processDefaults) */
  leaseConfig?: LeaseConfig;
};

/** Map of job type names to their processor configurations. Only registered types will be processed. */
export type InProcessWorkerProcessors<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions = Record<never, never>,
> = {
  [K in keyof TJobTypeDefinitions & string]?: InProcessWorkerProcessor<
    TStateAdapter,
    TJobTypeDefinitions & TExternalJobTypeDefinitions,
    K
  >;
};

/**
 * Define processors for a job type slice with full type inference, returning a
 * widened type that is assignable to any `InProcessWorkerProcessors` whose
 * definitions include the slice's job types.
 *
 * @example
 * const orderProcessors = defineJobTypeProcessors(orderJobTypes, {
 *   "orders.create": {
 *     attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
 *   },
 * });
 */
export const defineJobTypeProcessors = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
  TKeys extends keyof TJobTypeDefinitions & string,
>(
  _jobTypeRegistry: JobTypeRegistry<TJobTypeDefinitions, TExternalJobTypeDefinitions>,
  processors: {
    [K in TKeys]: InProcessWorkerProcessor<
      StateAdapter<any, any>,
      TJobTypeDefinitions & TExternalJobTypeDefinitions,
      K
    >;
  } & Record<Exclude<TKeys, keyof TJobTypeDefinitions & string>, never>,
): { [K in TKeys]: InProcessWorkerProcessor<StateAdapter<any, any>, any, K> } => {
  return processors as { [K in TKeys]: InProcessWorkerProcessor<StateAdapter<any, any>, any, K> };
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
  defaultBackoffConfig,
  defaultLeaseConfig,
  workerId,
  attemptMiddlewares,
}: {
  helpers: Helpers;
  typeNames: string[];
  processors: InProcessWorkerProcessors<any, any>;
  defaultBackoffConfig: BackoffConfig;
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
          backoffConfig: processor.backoffConfig ?? defaultBackoffConfig,
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

/**
 * Create an in-process worker for processing jobs.
 *
 * @param options.client - The Queuert client to process jobs for.
 * @param options.workerId - Unique worker identifier. Defaults to a random UUID.
 * @param options.concurrency - Maximum number of jobs to process in parallel. Defaults to 1.
 * @param options.backoffConfig - Backoff configuration for the worker loop itself (not job retries).
 * @param options.processDefaults - Default configuration applied to all job types unless overridden per-processor.
 * @param options.processors - Map of job type names to their processor configurations.
 */
export const createInProcessWorker = async <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  const TJobTypeProcessors extends InProcessWorkerProcessors<TStateAdapter, TJobTypeDefinitions>,
>({
  client,
  workerId = randomUUID(),
  concurrency,
  backoffConfig,
  processDefaults,
  processors,
}: {
  client: Client<TJobTypeDefinitions, TStateAdapter>;
  workerId?: string;
  concurrency?: number;
  backoffConfig?: BackoffConfig;
  processDefaults?: InProcessWorkerProcessDefaults<TStateAdapter, TJobTypeDefinitions>;
  processors: TJobTypeProcessors &
    Record<Exclude<keyof TJobTypeProcessors & string, keyof TJobTypeDefinitions & string>, never>;
}) => {
  const typeNames = Array.from(Object.keys(processors));

  const pollIntervalMs = processDefaults?.pollIntervalMs ?? 60_000;
  const defaultBackoffConfig = processDefaults?.backoffConfig ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const defaultLeaseConfig = processDefaults?.leaseConfig ?? {
    leaseMs: 60_000,
    renewIntervalMs: 30_000,
  };
  const workerBackoffConfig = backoffConfig ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const attemptMiddlewares = processDefaults?.attemptMiddlewares;

  return {
    start: async (): Promise<() => Promise<void>> => {
      const helpers = clientHelpersMap.get(client)!;
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
                defaultBackoffConfig,
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
              const reaped = await stateAdapter.reapExpiredJobLease({
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

      const runWorkerLoopPromise = withRetry(async () => runWorkerLoop(), workerBackoffConfig, {
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

/**
 * A worker that processes jobs in the current process. Created via {@link createInProcessWorker}.
 *
 * Call `start()` to begin processing. It returns a `stop` function — call it to gracefully shut down.
 */
export type InProcessWorker = ReturnType<typeof createInProcessWorker>;
