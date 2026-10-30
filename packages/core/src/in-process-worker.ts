import { sleep } from "@queuert/helpers";

import {
  type AnyAttemptMiddleware,
  type AttemptMiddleware,
  type IsAttemptMiddlewareSubsequence,
} from "./attempt-middleware/attempt-middleware.js";
import { type Client, helpersSymbol } from "./client.js";
import {
  type BackoffConfig,
  backoffConfigViolations,
  calculateBackoffMs,
} from "./entities/backoff.js";
import {
  type Processors,
  processorAttemptMiddlewareSymbol,
} from "./job-type-processors/job-type-processors.js";
import {
  type MergedProcessorDefinitions,
  type ValidatedProcessorSlices,
  mergeProcessors,
} from "./job-type-processors/merge-job-type-processors.js";
import { type BaseJobTypeDefinitions } from "./job-types/job-type.js";
import { type StateAdapter } from "./state-adapter/state-adapter.js";
import { type StampedProcessor, runWorker } from "./worker/run-worker.js";
import { type WorkerLeaseConfig, workerLeaseConfigViolations } from "./worker/worker-lease.js";

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

const failuresAfter = (
  failures: number,
  outcome: Awaited<ReturnType<typeof runWorker>>,
): number => {
  if (outcome.stop === "registrationFailed") return failures + 1;
  if (outcome.stop === "uncertainWrite") return outcome.healthy ? 1 : failures + 1;
  return 0;
};

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
};

/**
 * Create an in-process worker for processing jobs.
 *
 * Per-attempt configuration (`attemptMiddleware`, `backoffConfig`) lives on the
 * **processor registry** (see {@link createProcessors}). The worker dispatches to
 * whichever processor matches the job's typeName and runs that slice's middleware
 * chain. Worker-level `defaults` provide fallbacks for processors that don't set
 * `backoffConfig` themselves; precedence is processor > worker `defaults` > built-in
 * defaults.
 *
 * The in-process worker runs one worker at a time: a database row with a lease that
 * owns every attempt it starts. When that worker stops — its lease is lost, or a
 * write's outcome is unknown — it waits for every attempt to end, and the next one
 * starts under a fresh id: at once after a lost lease, after the `recoveryBackoffConfig`
 * backoff after a write whose outcome is unknown.
 *
 * @param options - Worker configuration.
 * @throws {TypeError} When `workerName` is empty, or when `recoveryBackoffConfig`, `lease`,
 * `defaults` or any processor's `backoffConfig` holds an invalid value; the message lists
 * every invalid field.
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
  lease: leaseOption,
  defaults: defaultsOption,
  requiredAttemptMiddleware: requiredAttemptMiddlewareOption,
  processors: processorsOption,
}: {
  /** The Queuert client to process jobs for. */
  client: Client<TJobTypeDefinitions, TStateAdapter>;
  /** Optional human-readable name stored with each worker and carried on its events. */
  workerName?: string;
  /** Maximum number of jobs to process in parallel. Defaults to 1. */
  concurrency?: number;
  /**
   * How often to poll for new jobs when no notify adapter wakes the worker.
   * Defaults to 60s.
   */
  pollIntervalMs?: number;
  /**
   * Backoff configuration for the worker loop itself (not job retries): between failed
   * iterations, and before the next worker starts after one stopped on a write whose
   * outcome is unknown.
   */
  recoveryBackoffConfig?: BackoffConfig;
  /**
   * Lease of each worker this in-process worker starts.
   *
   * @defaultValue `{ durationMs: 60_000, heartbeatMs: 15_000 }`
   */
  lease?: WorkerLeaseConfig;
  /** Fallback `backoffConfig` for processors that don't set their own. */
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
  const leaseConfig = leaseOption ?? { durationMs: 60_000, heartbeatMs: 15_000 };
  const configViolations = [
    ...backoffConfigViolations("recoveryBackoffConfig", recoveryBackoffConfig),
    ...workerLeaseConfigViolations("lease", leaseConfig),
    ...backoffConfigViolations("defaults.backoffConfig", defaultBackoffConfig),
    ...typeNames.flatMap((typeName) =>
      backoffConfigViolations(
        `processors["${typeName}"].backoffConfig`,
        processors[typeName].backoffConfig,
      ),
    ),
  ];
  if (configViolations.length > 0) {
    throw new TypeError(
      `createInProcessWorker: invalid configuration:\n${configViolations.map((v) => `  - ${v}`).join("\n")}`,
    );
  }
  const concurrencyValue = concurrency ?? 1;
  if (workerName !== undefined && (typeof workerName !== "string" || workerName.length === 0)) {
    throw new TypeError(
      `createInProcessWorker: workerName must be a non-empty string (got ${JSON.stringify(workerName)})`,
    );
  }

  return {
    start: async (): Promise<() => Promise<void>> => {
      const helpers = client[helpersSymbol];
      const stopController = new AbortController();

      const runWorkers = async () => {
        const recovery = { failures: 0 };
        while (!stopController.signal.aborted) {
          const outcome = await runWorker({
            helpers,
            workerName: workerName ?? null,
            typeNames,
            processors,
            concurrency: concurrencyValue,
            pollIntervalMs,
            recoveryBackoffConfig,
            defaultBackoffConfig,
            leaseConfig,
            stopSignal: stopController.signal,
          });
          recovery.failures = failuresAfter(recovery.failures, outcome);
          if (recovery.failures > 0) {
            await sleep(calculateBackoffMs(recovery.failures, recoveryBackoffConfig), {
              signal: stopController.signal,
            });
          }
        }
      };

      const runWorkersPromise = runWorkers()
        .catch((error: unknown) => {
          helpers.observabilityHelper.workerError(
            { workerId: "", workerName: workerName ?? null },
            error,
          );
        })
        .catch(() => {});

      return async () => {
        stopController.abort();
        await runWorkersPromise;
      };
    },
  };
};
