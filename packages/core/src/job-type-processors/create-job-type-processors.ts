import {
  type AnyAttemptMiddleware,
  type AttemptMiddleware,
  type MergedAttemptHandlerCtx,
} from "../attempt-middleware/attempt-middleware.js";
import { type Client } from "../client.js";
import { type BackoffConfig } from "../entities/backoff.js";
import { type BaseJobTypeDefinitions } from "../job-types/job-type.js";
import { type JobTypes } from "../job-types/job-types.js";
import { type JobTypeNames } from "../job-types/job-types.resolvers.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import {
  type InProcessWorkerProcessor,
  type Processors,
  processorAttemptMiddlewareSymbol,
  processorsDefinitionsSymbol,
  processorsMiddlewareSymbol,
} from "./job-type-processors.js";

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
 * references). The returned registry is plugged into `createInProcessWorker`.
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
 *         withTransactionHooks(async (transactionHooks) =>
 *           db.transaction(async (tx) => complete({ tx, transactionHooks, output: { orderId: "1" } })),
 *         ),
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
    [K in TProcessors]: InProcessWorkerProcessor<
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
    options.processors as Record<string, InProcessWorkerProcessor<any, any, any, any>>,
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
