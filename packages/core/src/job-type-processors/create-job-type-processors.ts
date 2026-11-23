import { isPositiveSafeInteger } from "@queuert/helpers/number";
import type { Mode } from "@queuert/sync-async";

import type {
  AnyAttemptMiddleware,
  AttemptMiddleware,
  MergedAttemptHandlerCtx,
} from "../attempt-middleware/attempt-middleware.ts";
import type { Client } from "../client/client.ts";
import { type BackoffConfig, backoffConfigViolations } from "../entities/backoff.ts";
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
 * Handlers follow the client's mode: over a client of a `"sync"` {@link StateAdapter}, their
 * `applyJobOutcome`, `applyJobOutcomes`, `fenceJob` and `fenceJobs` return their results
 * directly and throw synchronously.
 *
 * @example
 * const orderProcessors = createProcessors({
 *   client,
 *   jobTypes: orderJobTypes,
 *   attemptMiddleware: [tracingMiddleware, loggerMiddleware],
 *   processors: {
 *     "orders.create": {
 *       attemptHandler: async ({ applyJobOutcome, traceId, log }) => {
 *         await stateAdapter.withTransaction(async (txCtx) =>
 *           applyJobOutcome({ ...txCtx, output: { orderId: "1" } }),
 *         );
 *       },
 *     },
 *   },
 * });
 *
 * @throws {TypeError} When `backoffConfig`, or any processor's `backoffConfig` or `batchLimit`,
 * holds an invalid value; the message lists every invalid field.
 */
export const createProcessors = <
  TClientJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TExternalJobTypeDefinitions extends BaseJobTypeDefinitions,
  const TBatchLimits,
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
  attemptMiddleware?: TAttemptMiddleware &
    readonly AttemptMiddleware<NoInfer<TStateAdapter>, any>[];
  backoffConfig?: BackoffConfig;
  processors: {
    [K in keyof TBatchLimits]: Processor<
      TStateAdapter,
      TMergedJobTypeDefinitions,
      K & string,
      MergedAttemptHandlerCtx<TAttemptMiddleware>,
      TBatchLimits[K]
    >;
  } & Record<Exclude<keyof TBatchLimits, keyof TJobTypeDefinitions & string>, never>;
}): Processors<TJobTypeDefinitions, TAttemptMiddleware> => {
  const processorEntries = Object.entries<Processor<any, any, any, any, any>>(options.processors);
  const configViolations = [
    ...backoffConfigViolations("backoffConfig", options.backoffConfig),
    ...processorEntries.flatMap(([typeName, processor]) => [
      ...backoffConfigViolations(
        `processors["${typeName}"].backoffConfig`,
        processor.backoffConfig,
      ),
      ...(processor.batchLimit === undefined || isPositiveSafeInteger(processor.batchLimit)
        ? []
        : [
            `processors["${typeName}"].batchLimit must be a positive integer (got ${String(processor.batchLimit)})`,
          ]),
    ]),
  ];
  if (configViolations.length > 0) {
    throw new TypeError(
      `createProcessors: invalid configuration:\n${configViolations.map((v) => `  - ${v}`).join("\n")}`,
    );
  }
  const middleware = options.attemptMiddleware ?? [];
  const stampedProcessors: Record<string, unknown> = {};
  for (const [typeName, processor] of processorEntries) {
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
