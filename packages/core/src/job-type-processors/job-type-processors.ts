import type { Mode } from "@queuert/sync-async";

import type { AnyAttemptMiddleware } from "../attempt-middleware/attempt-middleware.ts";
import type { AttemptHandler, BatchAttemptHandler } from "../attempt/attempt-handler.types.ts";
import type { BackoffConfig } from "../entities/backoff.ts";
import type { BaseJobTypeDefinitions } from "../job-types/job-type.ts";
import type { JobTypeNames, JobTypeReachingEntry } from "../job-types/job-types.resolvers.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";

/**
 * Configuration for processing a single job type: either an `attemptHandler`, called with one
 * `job` per call, or a `batchAttemptHandler` with a `batchLimit`, called with `jobs`: up to
 * `batchLimit` jobs of the type that are due when the worker runner looks, never waiting for more,
 * each with its own attempt, in one call that takes one worker runner concurrency slot.
 */
export type Processor<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  THandlerCtx,
> =
  | {
      /**
       * Handler function called for each batch of job attempts.
       *
       * @experimental
       */
      batchAttemptHandler: BatchAttemptHandler<
        TStateAdapter,
        TJobTypeDefinitions,
        TJobTypeName,
        JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
        THandlerCtx
      >;
      /**
       * The most jobs one `batchAttemptHandler` call processes: a positive integer.
       *
       * @experimental
       */
      batchLimit: number;
      attemptHandler?: never;
      /** Per-job-type backoff configuration (overrides registry/worker runner defaults) */
      backoffConfig?: BackoffConfig;
    }
  | {
      /** Handler function called for each job attempt */
      attemptHandler: AttemptHandler<
        TStateAdapter,
        TJobTypeDefinitions,
        TJobTypeName,
        JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
        THandlerCtx
      >;
      batchAttemptHandler?: never;
      batchLimit?: never;
      /** Per-job-type backoff configuration (overrides registry/worker runner defaults) */
      backoffConfig?: BackoffConfig;
    };

/**
 * Symbol used to carry phantom job type definitions on a processor registry.
 * @internal
 */
export const processorsDefinitionsSymbol: unique symbol = Symbol("queuert.processor.definitions");

export const processorAttemptMiddlewareSymbol: unique symbol = Symbol(
  "queuert.processor.attemptMiddleware",
);

/**
 * Symbol used to carry the slice's middleware tuple type on a processor registry,
 * so the worker runner can compile-time-check it against `requiredAttemptMiddleware`.
 * The runtime tuple is also stamped per processor under
 * `processorAttemptMiddlewareSymbol`; this is purely a type-level carrier.
 * @internal
 */
export const processorsMiddlewareSymbol: unique symbol = Symbol("queuert.processor.middleware");

/** Extract the job type definitions from a {@link Processors}. */
export type ProcessorDefinitions<T extends Processors> = T[typeof processorsDefinitionsSymbol];

/** Extract the middleware tuple type from a {@link Processors}. @internal */
export type ProcessorMiddlewareTuple<T extends Processors> = T[typeof processorsMiddlewareSymbol];

/**
 * A processor registry that bundles processor implementations with their
 * type definitions and middleware tuple via phantom symbol properties.
 *
 * Created via {@link createProcessors}, or narrowed from an existing registry with
 * {@link pickProcessors} / {@link omitProcessors}. Pass an array of slices to
 * `createWorkerRunner` to merge multiple slices into one worker runner; slices must not share
 * job types.
 */
export type Processors<
  TJobTypeDefinitions extends BaseJobTypeDefinitions = BaseJobTypeDefinitions,
  TAttemptMiddleware extends readonly AnyAttemptMiddleware[] = readonly AnyAttemptMiddleware[],
> = {
  readonly [K in JobTypeNames<TJobTypeDefinitions>]: Processor<any, any, any, any>;
} & {
  readonly [processorsDefinitionsSymbol]: TJobTypeDefinitions;
  readonly [processorsMiddlewareSymbol]: TAttemptMiddleware;
};
