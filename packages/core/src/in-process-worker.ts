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
  type AttemptMiddleware,
  type IsAttemptMiddlewareSubsequence,
} from "./worker/attempt-middleware.js";
import { runJobProcess } from "./worker/job-process.js";
import { type LeaseConfig } from "./worker/lease.js";
import { type MergedProcessorDefinitions, mergeProcessors } from "./worker/merge-processors.js";
import {
  type InProcessWorkerProcessor,
  type Processors,
  processorAttemptMiddlewareSymbol,
} from "./worker/processors.js";

/** Per-processor runtime stamp carrying the middleware tuple of the originating slice. @internal */
type StampedProcessor = InProcessWorkerProcessor<any, any, any, any, any, any> & {
  readonly [processorAttemptMiddlewareSymbol]: readonly AttemptMiddleware<any, any, any, any>[];
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
      disposeNotified = await notifyAdapter.listenJobScheduled(typeNames, (typeName) => {
        notifyAdapter.consumeWakeHint(typeName).then(
          (claimed) => {
            if (claimed) onNotification();
          },
          () => {},
        );
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
}: {
  helpers: Helpers;
  typeNames: string[];
  processors: Record<string, StampedProcessor>;
  defaultBackoffConfig: BackoffConfig;
  defaultLeaseConfig: LeaseConfig;
  workerId: string;
}): Promise<
  { job: null; hasMore: false } | { job: StateJob; hasMore: boolean; execute: () => Promise<void> }
> => {
  const prepareTransactionContext = await createTransactionContext(
    helpers.stateAdapter.withTransaction,
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

  const jobTypeProcessor = processors[job.typeName];
  if (!jobTypeProcessor) {
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
          attemptHandler: jobTypeProcessor.attemptHandler as any,
          job,
          prepareTransactionContext: prepareTransactionContext as TransactionContext<BaseTxContext>,
          backoffConfig: jobTypeProcessor.backoffConfig ?? defaultBackoffConfig,
          leaseConfig: jobTypeProcessor.leaseConfig ?? defaultLeaseConfig,
          workerId,
          attemptMiddleware: jobTypeProcessor[processorAttemptMiddlewareSymbol],
        });
      } catch (error) {
        await prepareTransactionContext.reject(error);
        throw error;
      }
    },
  };
};

/** Merged-processor view of a scalar-or-array input. @internal */
type WorkerProcessorDefs<T> = T extends readonly Processors[]
  ? MergedProcessorDefinitions<T>
  : T extends Processors<infer D>
    ? D
    : never;

/** Distributive `keyof T & string` — returns all keys across a union, not common ones. @internal */
type DistributiveKeys<T> = T extends any ? keyof T & string : never;

/**
 * Extra job type names in the processors that the client doesn't know about.
 * When processor defs are widened to `string` keys (no inference possible),
 * returns `never` so the subset check passes trivially.
 * @internal
 */
type ExtraProcessorTypeNames<TProcessorDefs, TClientDefs> = [string] extends [
  DistributiveKeys<TProcessorDefs>,
]
  ? never
  : Exclude<DistributiveKeys<TProcessorDefs>, DistributiveKeys<TClientDefs>>;

/** Extract slice middleware tuple from a Processors instance (defaults to empty). @internal */
type SliceMiddleware<T> =
  T extends Processors<any, infer M extends readonly AttemptMiddleware<any, any, any, any>[]>
    ? M
    : readonly [];

/**
 * For each slice in the array, check whether its middleware tuple contains
 * `TReq` as an in-order subsequence; replace the slice element with an error
 * string when it does not. The mapped-tuple form lets TS pinpoint which slice
 * fails when the worker is constructed with an array of slices.
 * @internal
 */
type ValidateRequiredMiddlewareForSlices<
  TSlices extends readonly unknown[],
  TReq extends readonly AttemptMiddleware<any, any, any, any>[],
> = {
  [K in keyof TSlices]: IsAttemptMiddlewareSubsequence<
    TReq,
    SliceMiddleware<TSlices[K]>
  > extends true
    ? TSlices[K]
    : "Error: this slice does not include all requiredAttemptMiddleware in the declared order";
};

/**
 * Combined constraint result for the worker's `processors` option: either the
 * input unchanged (all checks pass), a single error string (single-slice form),
 * or a tuple with error strings substituted into the failing positions
 * (array-of-slices form).
 * @internal
 */
type ValidateRequiredMiddleware<
  TProcessorsInput,
  TReq extends readonly AttemptMiddleware<any, any, any, any>[],
> = [TReq] extends [readonly []]
  ? TProcessorsInput
  : TProcessorsInput extends readonly unknown[]
    ? ValidateRequiredMiddlewareForSlices<TProcessorsInput, TReq>
    : IsAttemptMiddlewareSubsequence<TReq, SliceMiddleware<TProcessorsInput>> extends true
      ? TProcessorsInput
      : "Error: processors slice does not include all requiredAttemptMiddleware in the declared order";

/**
 * A worker that processes jobs in the current process. Created via {@link createInProcessWorker}.
 *
 * Call `start()` to begin processing. It returns a `stop` function — call it to gracefully shut down.
 */
export type InProcessWorker = {
  /** Begin processing jobs. Returns a `stop` function that gracefully shuts down the worker. */
  start: () => Promise<() => Promise<void>>;
};

/**
 * Per-attempt defaults applied to every job type the worker processes,
 * unless overridden by the matching processor entry.
 */
export type InProcessWorkerDefaults = {
  /** Default backoff for failed job attempts. Overridden by per-processor `backoffConfig`. */
  backoffConfig?: BackoffConfig;
  /** Default lease for job ownership. Overridden by per-processor `leaseConfig`. */
  leaseConfig?: LeaseConfig;
};

/**
 * Create an in-process worker for processing jobs.
 *
 * Per-attempt configuration (`attemptMiddleware`, `backoffConfig`,
 * `leaseConfig`) lives on the **processor registry** (see {@link createProcessors}).
 * The worker dispatches to whichever processor matches the job's typeName and
 * runs that slice's middleware chain. Worker-level `defaults` provide fallbacks
 * for processors that don't set `backoffConfig` / `leaseConfig` themselves;
 * precedence is processor > worker `defaults` > built-in defaults.
 *
 * @param options.client - The Queuert client to process jobs for.
 * @param options.workerName - Optional human-readable label included in the worker id (which is always suffixed with a random UUID to guarantee uniqueness across replicas). Must match `/^[A-Za-z0-9._-]+$/` when provided.
 * @param options.concurrency - Maximum number of jobs to process in parallel. Defaults to 1.
 * @param options.pollIntervalMs - How often to poll for new jobs when no notify adapter wakes the worker. Defaults to 60s.
 * @param options.recoveryBackoffConfig - Backoff configuration for the worker loop itself (not job retries).
 * @param options.defaults - Fallback `backoffConfig` / `leaseConfig` for processors that don't set their own.
 * @param options.requiredAttemptMiddleware - Middleware instances that every dispatched processor's slice must include as an in-order subsequence. Enforced both at compile time (against the slice middleware tuple inferred by {@link createProcessors}) and at runtime by reference-identity (`===`). The worker does not execute this middleware itself — slices run their own chains.
 * @param options.processors - A single `Processors` from {@link createProcessors}, or an array of slices to merge.
 */
export const createInProcessWorker = async <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  const TProcessorsInput extends Processors | readonly Processors[] = Processors,
  const TRequiredAttemptMiddleware extends readonly AttemptMiddleware<any, any, any, any>[] =
    readonly [],
>({
  client,
  workerName,
  concurrency,
  pollIntervalMs: pollIntervalMsOption,
  recoveryBackoffConfig: recoveryBackoffConfigOption,
  defaults: defaultsOption,
  requiredAttemptMiddleware: requiredAttemptMiddlewareOption,
  processors: processorsOption,
}: {
  client: Client<TJobTypeDefinitions, TStateAdapter>;
  workerName?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  recoveryBackoffConfig?: BackoffConfig;
  defaults?: InProcessWorkerDefaults;
  requiredAttemptMiddleware?: TRequiredAttemptMiddleware;
  processors: [
    ExtraProcessorTypeNames<WorkerProcessorDefs<TProcessorsInput>, TJobTypeDefinitions>,
  ] extends [never]
    ? ValidateRequiredMiddleware<TProcessorsInput, TRequiredAttemptMiddleware>
    : `Error: processors contain job types unknown to the client: ${ExtraProcessorTypeNames<WorkerProcessorDefs<TProcessorsInput>, TJobTypeDefinitions> & string}`;
}): Promise<InProcessWorker> => {
  const merged = Array.isArray(processorsOption)
    ? processorsOption.length === 1
      ? (processorsOption[0] as Processors)
      : // ValidatedProcessorSlices duplicate-check is enforced at the createInProcessWorker signature;
        // internal cast bypasses it since the input is already validated.
        mergeProcessors(processorsOption as never)
    : (processorsOption as unknown as Processors);

  const processors = merged as unknown as Record<string, StampedProcessor>;
  const typeNames = Object.keys(processors);

  const requiredAttemptMiddleware = (requiredAttemptMiddlewareOption ??
    []) as readonly AttemptMiddleware<any, any, any, any>[];
  if (requiredAttemptMiddleware.length > 0) {
    const violations: string[] = [];
    for (const typeName of typeNames) {
      const sliceMW = processors[typeName][processorAttemptMiddlewareSymbol] ?? [];
      const missing: number[] = [];
      let i = 0;
      for (let r = 0; r < requiredAttemptMiddleware.length; r++) {
        while (i < sliceMW.length && sliceMW[i] !== requiredAttemptMiddleware[r]) i++;
        if (i >= sliceMW.length) {
          missing.push(r);
        } else {
          i++;
        }
      }
      if (missing.length > 0) {
        violations.push(
          `  - "${typeName}": missing requiredAttemptMiddleware at position(s) [${missing.join(", ")}]`,
        );
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `createInProcessWorker: one or more processors are missing requiredAttemptMiddleware (each slice must include every required middleware instance as an in-order subsequence):\n${violations.join("\n")}`,
      );
    }
  }

  const pollIntervalMs = pollIntervalMsOption ?? 60_000;
  const recoveryBackoffConfig = recoveryBackoffConfigOption ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const defaultBackoffConfig = defaultsOption?.backoffConfig ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const defaultLeaseConfig = defaultsOption?.leaseConfig ?? {
    leaseMs: 60_000,
    renewIntervalMs: 30_000,
  };
  const concurrencyValue = concurrency ?? 1;
  if (workerName !== undefined && !/^[A-Za-z0-9._-]+$/.test(workerName)) {
    throw new TypeError(
      `createInProcessWorker: workerName must be a non-empty string of letters, digits, '.', '_', or '-' (got ${JSON.stringify(workerName)})`,
    );
  }
  const workerId = workerName ? `${workerName}-${randomUUID()}` : randomUUID();

  return {
    start: async (): Promise<() => Promise<void>> => {
      const helpers = client[helpersSymbol];
      const { stateAdapter, notifyAdapter, observabilityHelper } = helpers;

      observabilityHelper.workerStarted({ workerId, jobTypeNames: typeNames });
      observabilityHelper.jobTypeIdleChange(concurrencyValue, workerId, typeNames);

      const stopController = new AbortController();
      const executor = createParallelExecutor(concurrencyValue);
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
                  await notifyAdapter.provideWakeHint(reaped.typeName, 1);
                  await notifyAdapter.notifyJobScheduled(reaped.typeName);
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

      const runWorkerLoopPromise = withRetry(async () => runWorkerLoop(), recoveryBackoffConfig, {
        signal: stopController.signal,
      }).catch(() => {});

      return async () => {
        observabilityHelper.workerStopping({ workerId });
        stopController.abort();
        await runWorkerLoopPromise;
        await executor.drain();
        observabilityHelper.jobTypeIdleChange(-concurrencyValue, workerId, typeNames);
        observabilityHelper.workerStopped({ workerId });
      };
    },
  };
};
