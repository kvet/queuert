import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type JobTypeNames, type JobTypeReachingEntry } from "../entities/job-types.resolvers.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type AttemptMiddleware } from "./attempt-middleware.js";
import { type AttemptHandler } from "./job-process.js";
import { type LeaseConfig } from "./lease.js";

/** Configuration for processing a single job type. */
export type InProcessWorkerProcessor<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  THandlerCtx extends Record<string, unknown>,
  TPrepareCtx extends Record<string, unknown>,
  TCompleteCtx extends Record<string, unknown>,
> = {
  /** Handler function called for each job attempt */
  attemptHandler: AttemptHandler<
    TStateAdapter,
    TJobTypeDefinitions,
    TJobTypeName,
    JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
    THandlerCtx,
    TPrepareCtx,
    TCompleteCtx
  >;
  /** Per-job-type backoff configuration (overrides registry/worker defaults) */
  backoffConfig?: BackoffConfig;
  /** Per-job-type lease configuration (overrides registry/worker defaults) */
  leaseConfig?: LeaseConfig;
};

/**
 * Symbol used to carry phantom job type definitions on a processor registry.
 * @internal
 */
export const processorsDefinitionsSymbol: unique symbol = Symbol("queuert.processor.definitions");

/**
 * Per-processor stamp carrying the middleware tuple of the slice that created
 * this processor. Runtime dispatch reads this to run the correct middleware
 * chain for each job type. Not reflected in the public type — purely a
 * runtime implementation detail.
 * @internal
 */
export const processorAttemptMiddlewareSymbol: unique symbol = Symbol(
  "queuert.processor.attemptMiddleware",
);

/**
 * Symbol used to carry the slice's middleware tuple type on a processor registry,
 * so the worker can compile-time-check it against `requiredAttemptMiddleware`.
 * The runtime tuple is also stamped per processor under
 * {@link processorAttemptMiddlewareSymbol}; this is purely a type-level carrier.
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
 * Created via {@link createProcessors}. Pass an array of slices to
 * `createInProcessWorker` to merge multiple slices into one worker.
 */
export type Processors<
  TJobTypeDefinitions extends BaseJobTypeDefinitions = BaseJobTypeDefinitions,
  TAttemptMiddleware extends readonly AttemptMiddleware<any, any, any, any>[] =
    readonly AttemptMiddleware<any, any, any, any>[],
> = {
  readonly [K in JobTypeNames<TJobTypeDefinitions>]: InProcessWorkerProcessor<
    any,
    any,
    any,
    any,
    any,
    any
  >;
} & {
  readonly [processorsDefinitionsSymbol]: TJobTypeDefinitions;
  readonly [processorsMiddlewareSymbol]: TAttemptMiddleware;
};
