import type {
  AnyAttemptMiddleware,
  AttemptMiddleware,
  MergedAttemptHandlerCtx,
} from "../attempt-middleware/attempt-middleware.ts";
import type { Client } from "../client.ts";
import type { BackoffConfig } from "../entities/backoff.ts";
import type { BaseJobTypeDefinitions } from "../job-types/job-type.ts";
import type { JobTypeNames } from "../job-types/job-types.resolvers.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import {
  type Processor,
  type Processors,
  processorAttemptMiddlewareSymbol,
  processorsDefinitionsSymbol,
  processorsMiddlewareSymbol,
} from "./job-type-processors.ts";

/** Merged definitions: union of own + external defs for typing handler continueWith / blockers. */
type MergedDefs<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
> = [JobTypeNames<TExternalJobTypeDefinitions>] extends [never]
  ? TJobTypeDefinitions
  : TJobTypeDefinitions | TExternalJobTypeDefinitions;

/**
 * Define a processor registry for a job type slice with full type inference.
 * Handlers are type-checked against the slice's own definitions plus any
 * external definitions it declares (for cross-slice blocker / continueWith
 * references). The returned registry is plugged into `createWorkerRunner`.
 *
 * A registry-level `backoffConfig` cascades onto every processor in this
 * registry unless that processor overrides it.
 *
 * @example
 * const orderProcessors = createProcessors({
 *   client,
 *   jobTypes: orderJobTypes,
 *   attemptMiddleware: [tracingMiddleware, loggerMiddleware],
 *   processors: {
 *     "orders.create": {
 *       attemptHandler: async ({ complete, traceId, log }) =>
 *         withTxHooks(async (txHooks) =>
 *           db.transaction(async (tx) => complete({ tx, txHooks, output: { orderId: "1" } })),
 *         ),
 *     },
 *   },
 * });
 */
export const createProcessors = <
  TClientJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
  TProcessors extends keyof TJobTypeDefinitions & string,
  const TAttemptMiddleware extends readonly AnyAttemptMiddleware[] = readonly [],
  TMergedJobTypeDefinitions extends BaseJobTypeDefinitions = MergedDefs<
    TJobTypeDefinitions,
    TExternalJobTypeDefinitions
  >,
>(options: {
  client: [TJobTypeDefinitions] extends [TClientJobTypeDefinitions]
    ? Client<TClientJobTypeDefinitions, TStateAdapter>
    : `Error: client is missing required job types: ${Exclude<keyof TJobTypeDefinitions & string, keyof TClientJobTypeDefinitions & string>}`;
  jobTypes: JobTypes<TJobTypeDefinitions, TExternalJobTypeDefinitions>;
  attemptMiddleware?: TAttemptMiddleware & readonly AttemptMiddleware<TStateAdapter, any>[];
  backoffConfig?: BackoffConfig;
  processors: {
    [K in TProcessors]: Processor<
      TStateAdapter,
      TMergedJobTypeDefinitions,
      K,
      MergedAttemptHandlerCtx<TAttemptMiddleware>
    >;
  } & Record<Exclude<TProcessors, keyof TJobTypeDefinitions & string>, never>;
}): Processors<TJobTypeDefinitions, TAttemptMiddleware> => {
  const middleware = options.attemptMiddleware ?? [];
  const stampedProcessors: Record<string, unknown> = {};
  for (const [typeName, processor] of Object.entries(
    options.processors as Record<string, Processor<any, any, any, any>>,
  )) {
    stampedProcessors[typeName] = Object.assign(
      {},
      processor,
      options.backoffConfig !== undefined && processor.backoffConfig === undefined
        ? { backoffConfig: options.backoffConfig }
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
