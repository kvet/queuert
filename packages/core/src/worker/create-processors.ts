import { type Client } from "../client.js";
import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type JobTypes } from "../entities/job-types.js";
import { type BackoffConfig } from "../helpers/backoff.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import {
  type AttemptMiddleware,
  type MergedAttemptHandlerCtx,
  type MergedCompleteCtx,
  type MergedPrepareCtx,
} from "./attempt-middleware.js";
import { type LeaseConfig } from "./lease.js";
import {
  type InProcessWorkerProcessor,
  type Processors,
  processorAttemptMiddlewareSymbol,
  processorsDefinitionsSymbol,
  processorsMiddlewareSymbol,
} from "./processors.js";

/** Merged definitions: union of own + external defs for typing handler continueWith / blockers. */
type MergedDefs<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
> = [keyof TExternalJobTypeDefinitions & string] extends [never]
  ? TJobTypeDefinitions
  : TJobTypeDefinitions | TExternalJobTypeDefinitions;

/**
 * Define a processor registry for a job type slice with full type inference.
 * Handlers are type-checked against the slice's own definitions plus any
 * external definitions it declares (for cross-slice blocker / continueWith
 * references). The returned registry is plugged into `createInProcessWorker`.
 *
 * Registry-level `backoffConfig` / `leaseConfig` cascade onto every processor
 * in this registry unless that processor overrides them.
 *
 * @example
 * const orderProcessors = createProcessors({
 *   client,
 *   jobTypes: orderJobTypes,
 *   attemptMiddleware: [tracingMiddleware, loggerMiddleware],
 *   processors: {
 *     "orders.create": {
 *       attemptHandler: async ({ complete, traceId, log }) => complete(async () => ({ orderId: "1" })),
 *     },
 *   },
 * });
 */
export const createProcessors = <
  TClientJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
  TProcessors extends keyof TJobTypeDefinitions & string,
  const TAttemptMiddleware extends readonly AttemptMiddleware<any, any, any, any>[] = readonly [],
  TMergedJobTypeDefinitions extends BaseJobTypeDefinitions = MergedDefs<
    TJobTypeDefinitions,
    TExternalJobTypeDefinitions
  >,
>(options: {
  client: [TJobTypeDefinitions] extends [TClientJobTypeDefinitions]
    ? Client<TClientJobTypeDefinitions, TStateAdapter>
    : `Error: client is missing required job types: ${Exclude<keyof TJobTypeDefinitions & string, keyof TClientJobTypeDefinitions & string>}`;
  jobTypes: JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions>;
  attemptMiddleware?: TAttemptMiddleware;
  backoffConfig?: BackoffConfig;
  leaseConfig?: LeaseConfig;
  processors: {
    [K in TProcessors]: InProcessWorkerProcessor<
      TStateAdapter,
      TMergedJobTypeDefinitions,
      K,
      MergedAttemptHandlerCtx<TAttemptMiddleware>,
      MergedPrepareCtx<TAttemptMiddleware>,
      MergedCompleteCtx<TAttemptMiddleware>
    >;
  } & Record<Exclude<TProcessors, keyof TJobTypeDefinitions & string>, never>;
}): Processors<TJobTypeDefinitions, TAttemptMiddleware> => {
  const middleware = options.attemptMiddleware ?? [];
  const stampedProcessors: Record<string, unknown> = {};
  for (const [typeName, processor] of Object.entries(
    options.processors as Record<string, InProcessWorkerProcessor<any, any, any, any, any, any>>,
  )) {
    stampedProcessors[typeName] = Object.assign(
      {},
      processor,
      options.backoffConfig !== undefined && processor.backoffConfig === undefined
        ? { backoffConfig: options.backoffConfig }
        : {},
      options.leaseConfig !== undefined && processor.leaseConfig === undefined
        ? { leaseConfig: options.leaseConfig }
        : {},
      {
        [processorAttemptMiddlewareSymbol]: middleware,
      },
    );
  }
  return Object.assign({}, stampedProcessors, {
    [processorsDefinitionsSymbol]: undefined as unknown as TJobTypeDefinitions,
    [processorsMiddlewareSymbol]: middleware as unknown as TAttemptMiddleware,
  }) as Processors<TJobTypeDefinitions, TAttemptMiddleware>;
};
