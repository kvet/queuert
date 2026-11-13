import type {
  AnyAttemptMiddleware,
  AttemptMiddleware,
  IsAttemptMiddlewareSubsequence,
} from "../attempt-middleware/attempt-middleware.ts";
import { type Client, helpersSymbol } from "../client/client.ts";
import type { BackoffConfig } from "../entities/backoff.ts";
import type { Processors } from "../job-type-processors/job-type-processors.ts";
import type {
  MergedProcessorDefinitions,
  ValidatedProcessorSlices,
} from "../job-type-processors/merge-job-type-processors.ts";
import type { BaseJobTypeDefinitions } from "../job-types/job-type.ts";
import type { AnyStateAdapter, GetStateAdapterWorkerId } from "../state-adapter/state-adapter.ts";
import { buildWorkerRunner } from "./build-worker-runner.ts";
import { runWorker } from "./run-worker.ts";
import type { WorkerLeaseConfig } from "./worker-lease.ts";

/** Merged-processor view of a scalar-or-array input. @internal */
export type WorkerProcessorDefs<T> = T extends readonly Processors[]
  ? MergedProcessorDefinitions<T>
  : T extends Processors<infer D>
    ? D
    : never;

/** Distributive `keyof T & string` — returns all keys across a union, not common ones. @internal */
export type DistributiveKeys<T> = T extends any ? keyof T & string : never;

/**
 * Extra job type names in the processors that the client doesn't know about.
 * When processor defs are widened to `string` keys (no inference possible),
 * returns `never` so the subset check passes trivially.
 * @internal
 */
export type ExtraProcessorTypeNames<TProcessorDefs, TClientDefs> = [string] extends [
  DistributiveKeys<TProcessorDefs>,
]
  ? never
  : Exclude<DistributiveKeys<TProcessorDefs>, DistributiveKeys<TClientDefs>>;

/** Extract slice middleware tuple from a Processors instance (defaults to empty). @internal */
export type SliceMiddleware<T> =
  T extends Processors<any, infer M extends readonly AnyAttemptMiddleware[]> ? M : readonly [];

/**
 * For each slice in the array, check whether its middleware tuple contains
 * `TReq` as an in-order subsequence; replace the slice element with an error
 * string when it does not. The mapped-tuple form lets TS pinpoint which slice
 * fails when the worker runner is constructed with an array of slices.
 * @internal
 */
export type ValidateRequiredMiddlewareForSlices<
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
 * Combined constraint result for the worker runner's `processors` option: either the
 * input unchanged (all checks pass), a single error string (single-slice form),
 * or a tuple with error strings substituted into the failing positions
 * (array-of-slices form).
 * @internal
 */
export type ValidateRequiredMiddleware<
  TProcessorsInput,
  TReq extends readonly AnyAttemptMiddleware[],
> = [TReq] extends [readonly []]
  ? TProcessorsInput
  : TProcessorsInput extends readonly unknown[]
    ? ValidateRequiredMiddlewareForSlices<TProcessorsInput, TReq>
    : IsAttemptMiddlewareSubsequence<TReq, SliceMiddleware<TProcessorsInput>> extends true
      ? TProcessorsInput
      : "Error: processors slice does not include all requiredAttemptMiddleware in the declared order";

/**
 * A worker runner that processes jobs in the current process. Created via {@link createWorkerRunner}.
 *
 * Call `start()` to begin processing and `stop()` to shut down gracefully; a stopped worker runner
 * can be started again. `close()` stops it for good, and `[Symbol.asyncDispose]` calls `close()`,
 * so a worker runner held with `await using` is stopped when the scope ends.
 */
export type WorkerRunner = {
  /**
   * Begin processing jobs in the background. Resolves once processing is started, without waiting
   * for the worker to register.
   *
   * @throws {Error} if the worker runner is already started and `stop()` has not resolved.
   * @throws {Error} if the worker runner is closed.
   */
  start: () => Promise<void>;
  /**
   * Stop processing: abort the running attempts' signals, wait for every attempt to end and remove
   * the worker's registration. Does nothing when the worker runner is not started; concurrent calls
   * wait for the same shutdown. Never rejects.
   */
  stop: () => Promise<void>;
  /** Stop the worker runner if it is started and prevent it from starting again. Idempotent. */
  close: () => Promise<void>;
  /** Calls `close()`. */
  [Symbol.asyncDispose]: () => Promise<void>;
};

/**
 * Create a worker runner for processing jobs.
 *
 * Per-attempt configuration (`attemptMiddleware`, `backoffConfig`) lives on the **processor
 * registry** (see {@link createProcessors}). The worker runner dispatches to whichever processor
 * matches the job's typeName and runs that slice's middleware chain. The worker runner's
 * `backoffConfig` is the fallback for processors that don't set their own; precedence is
 * processor > processor registry > worker runner > built-in default.
 *
 * The worker runner registers one worker at a time under `workerId`, a row with a lease it
 * renews. When the lease is lost, it aborts the attempts' signals, waits for every attempt to
 * end and registers again under the same id.
 *
 * @param options - Worker runner configuration.
 * @throws {TypeError} When `concurrency`, `pollIntervalMs`, `recoveryBackoffConfig`, `leaseConfig`,
 * `backoffConfig` or any processor's `backoffConfig` holds an invalid value; the message lists
 * every invalid field.
 * @throws {@link InvalidWorkerIdError} if `workerId` fails the state adapter's
 * `validateWorkerId`.
 * @throws {@link DuplicateJobTypeError} if slices in a `processors` array share job types.
 * @throws {Error} if a processor's slice is missing `requiredAttemptMiddleware` or has it out of
 * order.
 */
export const createWorkerRunner = <
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends AnyStateAdapter,
  const TProcessorsInput extends Processors | readonly Processors[] = Processors,
  const TRequiredAttemptMiddleware extends readonly AnyAttemptMiddleware[] = readonly [],
>({
  client,
  ...options
}: {
  /** The Queuert client to process jobs for. */
  client: Client<TJobTypeDefinitions, TStateAdapter>;
  /**
   * Id the worker registers under, kept when it registers again after a lost lease. Pass a fixed
   * id to keep it across process restarts. While a live worker holds it, the worker runner waits
   * for that lease to expire before it starts.
   *
   * @defaultValue the state adapter's `generateWorkerId()`
   */
  workerId?: GetStateAdapterWorkerId<TStateAdapter>;
  /**
   * Maximum number of jobs to process in parallel. Must be a positive integer.
   *
   * @defaultValue `1`
   */
  concurrency?: number;
  /**
   * How often to poll for new jobs when no notify adapter wakes the worker. Must be finite and
   * positive.
   *
   * @defaultValue `60_000`
   */
  pollIntervalMs?: number;
  /**
   * Backoff after a failed worker loop iteration, a failed registration or a lost lease. It
   * resets once the worker starts a job.
   *
   * @defaultValue `{ initialDelayMs: 10_000, multiplier: 2, maxDelayMs: 300_000 }`
   */
  recoveryBackoffConfig?: BackoffConfig;
  /**
   * The lease the worker runner registers its worker with. Both fields are required when it
   * is passed.
   *
   * @defaultValue `{ durationMs: 60_000, heartbeatMs: 15_000 }`
   */
  leaseConfig?: WorkerLeaseConfig;
  /**
   * Backoff for failed job attempts of processors that don't set their own `backoffConfig`.
   *
   * @defaultValue `{ initialDelayMs: 10_000, multiplier: 2, maxDelayMs: 300_000 }`
   */
  backoffConfig?: BackoffConfig;
  /**
   * Middleware every processor's slice must include, in this order. The worker runner does not
   * run it.
   */
  requiredAttemptMiddleware?: TRequiredAttemptMiddleware &
    readonly AttemptMiddleware<NoInfer<TStateAdapter>, any>[];
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
}): WorkerRunner =>
  buildWorkerRunner({
    ...options,
    factoryName: "createWorkerRunner",
    helpers: client[helpersSymbol],
    runRegistration: runWorker,
  });
