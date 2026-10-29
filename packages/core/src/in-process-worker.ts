import { randomUUID } from "node:crypto";

import {
  raceWithSleep,
  type ParallelExecutor,
  createParallelExecutor,
  serializeError,
} from "@queuert/helpers";

import {
  type AnyAttemptMiddleware,
  type AttemptMiddleware,
  type IsAttemptMiddlewareSubsequence,
} from "./attempt-middleware/attempt-middleware.js";
import { type AttemptConfig, attemptConfigViolations } from "./attempt/attempt-config.js";
import { runAttempt } from "./attempt/attempt-handler.js";
import { type Client, helpersSymbol } from "./client.js";
import { type BackoffConfig, backoffConfigViolations } from "./entities/backoff.js";
import { withRetry } from "./entities/retry.js";
import { JobAttemptExpiredError } from "./errors.js";
import {
  type InProcessWorkerProcessor,
  type Processors,
  processorAttemptMiddlewareSymbol,
} from "./job-type-processors/job-type-processors.js";
import {
  type MergedProcessorDefinitions,
  type ValidatedProcessorSlices,
  mergeProcessors,
} from "./job-type-processors/merge-job-type-processors.js";
import { type BaseJobTypeDefinitions } from "./job-types/job-type.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type StateAdapter, type StateJob } from "./state-adapter/state-adapter.js";

/** Per-processor runtime stamp carrying the middleware tuple of the originating slice. @internal */
type StampedProcessor = InProcessWorkerProcessor<any, any, any, any> & {
  readonly [processorAttemptMiddlewareSymbol]: readonly AnyAttemptMiddleware[];
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
  const { promise: slotAvailable, resolve: onSlotAvailable } = Promise.withResolvers<void>();
  const disposeSlotAvailable = executor.onIdleSlot(onSlotAvailable);
  try {
    if (signal.aborted) {
      return;
    }

    if (executor.idleSlots() === 0) {
      await raceWithSleep(slotAvailable, pollIntervalMs, {
        jitterMs: pollIntervalMs / 10,
        signal,
      });
      return;
    }

    const { promise: notified, resolve: onNotification } = Promise.withResolvers<void>();
    let disposeNotified: () => Promise<void> = async () => {};
    try {
      disposeNotified = await notifyAdapter.listenJobScheduled(typeNames, () => {
        onNotification();
      });
    } catch {}

    try {
      const startAttemptDelayMs = await stateAdapter.getStartAttemptDelayMs({ typeNames });
      const pullDelayMs = Math.min(startAttemptDelayMs ?? pollIntervalMs, pollIntervalMs);

      if (signal.aborted) {
        return;
      }
      await raceWithSleep(Promise.race([slotAvailable, notified]), pullDelayMs, {
        jitterMs: pullDelayMs / 10,
        signal,
      });
    } finally {
      await disposeNotified();
    }
  } finally {
    disposeSlotAvailable();
  }
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
  T extends Processors<any, infer M extends readonly AnyAttemptMiddleware[]> ? M : readonly [];

/**
 * For each slice in the array, check whether its middleware tuple contains
 * `TReq` as an in-order subsequence; replace the slice element with an error
 * string when it does not. The mapped-tuple form lets TS pinpoint which slice
 * fails when the worker is constructed with an array of slices.
 * @internal
 */
type ValidateRequiredMiddlewareForSlices<
  TSlices extends readonly unknown[],
  TReq extends readonly AnyAttemptMiddleware[],
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
type ValidateRequiredMiddleware<TProcessorsInput, TReq extends readonly AnyAttemptMiddleware[]> = [
  TReq,
] extends [readonly []]
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
  /** Default attempt timeout and heartbeat. Overridden by per-processor `attemptConfig`. */
  attemptConfig?: AttemptConfig;
};

/**
 * Create an in-process worker for processing jobs.
 *
 * Per-attempt configuration (`attemptMiddleware`, `backoffConfig`,
 * `attemptConfig`) lives on the **processor registry** (see {@link createProcessors}).
 * The worker dispatches to whichever processor matches the job's typeName and
 * runs that slice's middleware chain. Worker-level `defaults` provide fallbacks
 * for processors that don't set `backoffConfig` / `attemptConfig` themselves;
 * precedence is processor > worker `defaults` > built-in defaults.
 *
 * @param options - Worker configuration.
 * @throws {TypeError} When `workerName` is malformed, or when `recoveryBackoffConfig`,
 * `defaults` or any processor's `backoffConfig` / `attemptConfig` holds an invalid value;
 * the message lists every invalid field.
 * @throws {@link DuplicateJobTypeError} if slices in a `processors` array share job types.
 */
export const createInProcessWorker = async <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  const TProcessorsInput extends Processors | readonly Processors[] = Processors,
  const TRequiredAttemptMiddleware extends readonly AnyAttemptMiddleware[] = readonly [],
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
  /** The Queuert client to process jobs for. */
  client: Client<TJobTypeDefinitions, TStateAdapter>;
  /**
   * Optional human-readable label included in the worker id (which is always
   * suffixed with a random UUID to guarantee uniqueness across replicas). Must
   * match `/^[A-Za-z0-9._-]+$/` when provided.
   */
  workerName?: string;
  /** Maximum number of jobs to process in parallel. Defaults to 1. */
  concurrency?: number;
  /**
   * How often to poll for new jobs when no notify adapter wakes the worker.
   * Defaults to 60s.
   */
  pollIntervalMs?: number;
  /** Backoff configuration for the worker loop itself (not job retries). */
  recoveryBackoffConfig?: BackoffConfig;
  /** Fallback `backoffConfig` / `attemptConfig` for processors that don't set their own. */
  defaults?: InProcessWorkerDefaults;
  /**
   * Middleware instances that every dispatched processor's slice must include
   * as an in-order subsequence. Enforced both at compile time (against the
   * slice middleware tuple inferred by {@link createProcessors}) and at runtime
   * by reference-identity (`===`). The worker does not execute this middleware
   * itself — slices run their own chains.
   *
   * Same adapter guard as `createProcessors`'s `attemptMiddleware`.
   */
  requiredAttemptMiddleware?: TRequiredAttemptMiddleware &
    readonly AttemptMiddleware<TStateAdapter, any>[];
  /**
   * A single `Processors` (from {@link createProcessors}, {@link pickProcessors} or
   * {@link omitProcessors}), or an array of slices to merge. Slices must not share job types:
   * an overlap is a type error when the array's length is known at compile time, and throws
   * {@link DuplicateJobTypeError} at runtime.
   */
  processors: [
    ExtraProcessorTypeNames<WorkerProcessorDefs<TProcessorsInput>, TJobTypeDefinitions>,
  ] extends [never]
    ? ValidateRequiredMiddleware<TProcessorsInput, TRequiredAttemptMiddleware> &
        (TProcessorsInput extends readonly Processors[]
          ? number extends TProcessorsInput["length"]
            ? unknown
            : ValidatedProcessorSlices<TProcessorsInput>
          : unknown)
    : `Error: processors contain job types unknown to the client: ${ExtraProcessorTypeNames<WorkerProcessorDefs<TProcessorsInput>, TJobTypeDefinitions> & string}`;
}): Promise<InProcessWorker> => {
  const merged = Array.isArray(processorsOption)
    ? processorsOption.length === 1
      ? (processorsOption[0] as Processors)
      : // ValidatedProcessorSlices duplicate-check is enforced at the createInProcessWorker signature
        // for fixed-length arrays only; mergeProcessors re-checks at runtime either way.
        mergeProcessors(processorsOption as never)
    : (processorsOption as unknown as Processors);

  const processors = merged as unknown as Record<string, StampedProcessor>;
  const typeNames = Object.keys(processors);

  const requiredAttemptMiddleware = (requiredAttemptMiddlewareOption ??
    []) as readonly AnyAttemptMiddleware[];
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
  const defaultAttemptConfig = defaultsOption?.attemptConfig ?? {
    timeoutMs: 60_000,
    heartbeatMs: 30_000,
  };
  const configViolations = [
    ...backoffConfigViolations("recoveryBackoffConfig", recoveryBackoffConfig),
    ...backoffConfigViolations("defaults.backoffConfig", defaultBackoffConfig),
    ...attemptConfigViolations("defaults.attemptConfig", defaultAttemptConfig),
    ...typeNames.flatMap((typeName) => [
      ...backoffConfigViolations(
        `processors["${typeName}"].backoffConfig`,
        processors[typeName].backoffConfig,
      ),
      ...attemptConfigViolations(
        `processors["${typeName}"].attemptConfig`,
        processors[typeName].attemptConfig,
      ),
    ]),
  ];
  if (configViolations.length > 0) {
    throw new TypeError(
      `createInProcessWorker: invalid configuration:\n${configViolations.map((v) => `  - ${v}`).join("\n")}`,
    );
  }
  const concurrencyValue = concurrency ?? 1;
  if (workerName !== undefined && !/^[A-Za-z0-9._-]+$/.test(workerName)) {
    throw new TypeError(
      `createInProcessWorker: workerName must be a non-empty string of letters, digits, '.', '_', or '-' (got ${JSON.stringify(workerName)})`,
    );
  }
  const workerId = workerName ? `${workerName}-${randomUUID()}` : randomUUID();
  const timeoutMsByTypeName = Object.fromEntries(
    typeNames.map((typeName) => [
      typeName,
      (processors[typeName].attemptConfig ?? defaultAttemptConfig).timeoutMs,
    ]),
  );

  return {
    start: async (): Promise<() => Promise<void>> => {
      const helpers = client[helpersSymbol];
      const { stateAdapter, notifyAdapter, observabilityHelper } = helpers;

      observabilityHelper.workerStarted({ workerId, jobTypeNames: typeNames });
      observabilityHelper.jobTypeIdleChange(concurrencyValue, workerId, typeNames);

      const stopController = new AbortController();
      const executor = createParallelExecutor(concurrencyValue);
      const jobIdsInProgress = new Set<string>();

      const dispatchJob = (stateJob: StateJob & { hasBlockers: boolean }) => {
        jobIdsInProgress.add(stateJob.id);
        void executor.add(async () => {
          observabilityHelper.jobTypeProcessingChange(1, stateJob, workerId);
          observabilityHelper.jobTypeIdleChange(-1, workerId, typeNames);
          try {
            const jobTypeProcessor = processors[stateJob.typeName];
            if (!jobTypeProcessor) {
              throw new Error(`No attempt handler registered for job type "${stateJob.typeName}"`);
            }
            await runAttempt({
              helpers,
              attemptHandler: jobTypeProcessor.attemptHandler,
              stateJob,
              backoffConfig: jobTypeProcessor.backoffConfig ?? defaultBackoffConfig,
              attemptConfig: jobTypeProcessor.attemptConfig ?? defaultAttemptConfig,
              workerId,
              attemptMiddleware: jobTypeProcessor[processorAttemptMiddlewareSymbol],
              stopSignal: stopController.signal,
            });
          } catch (error) {
            observabilityHelper.workerError({ workerId }, error);
          } finally {
            jobIdsInProgress.delete(stateJob.id);
            observabilityHelper.jobTypeIdleChange(1, workerId, typeNames);
            observabilityHelper.jobTypeProcessingChange(-1, stateJob, workerId);
          }
        });
      };

      const runWorkerIteration = async () => {
        try {
          while (executor.idleSlots() > 0) {
            const limit = executor.idleSlots();
            const stateJobs = await stateAdapter.startJobAttempts({
              timeoutMsByTypeName,
              workerId,
              limit,
            });
            for (const stateJob of stateJobs) {
              dispatchJob(stateJob);
            }
            if (stateJobs.length < limit) {
              break;
            }
          }

          if (stopController.signal.aborted) {
            return;
          }

          if (executor.idleSlots() > 0) {
            const reclaimedJobs = await stateAdapter.reclaimExpiredJobAttempts({
              typeNames,
              ignoredJobIds: Array.from(jobIdsInProgress),
              lastAttemptError: serializeError(
                new JobAttemptExpiredError(
                  "Job attempt expired before the holding worker extended it",
                  { reclaimedBy: workerId },
                ),
              ),
              limit: executor.idleSlots(),
            });

            for (const reclaimed of reclaimedJobs) {
              observabilityHelper.jobAttemptReclaimed(reclaimed, { workerId });
            }
            if (reclaimedJobs.length > 0) {
              await notifyAdapter
                .notifyJobAttemptsLost(reclaimedJobs.map((reclaimed) => reclaimed.id))
                .catch(() => {});
            }

            if (stopController.signal.aborted) {
              return;
            }

            if (reclaimedJobs.length > 0) {
              return;
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
        } catch (error) {
          observabilityHelper.workerError({ workerId }, error);
          throw error;
        }
      };

      const runWorkerLoop = async () => {
        while (!stopController.signal.aborted) {
          await withRetry(runWorkerIteration, recoveryBackoffConfig, {
            signal: stopController.signal,
          });
        }
      };

      const runWorkerLoopPromise = runWorkerLoop().catch(() => {});

      return async () => {
        stopController.abort();
        await runWorkerLoopPromise;
        await executor.drain();
        observabilityHelper.jobTypeIdleChange(-concurrencyValue, workerId, typeNames);
        observabilityHelper.workerStopped({ workerId });
      };
    },
  };
};
