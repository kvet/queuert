import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type ResolvedJobWithBlockers } from "../entities/job-types.resolvers.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

type RunningJob<TStateAdapter extends StateAdapter<BaseTxContext, any>> = ResolvedJobWithBlockers<
  GetStateAdapterJobId<TStateAdapter>,
  BaseJobTypeDefinitions,
  string,
  string
> & { status: "running" };

/**
 * Wraps job processing with cross-cutting logic for one or more phases.
 *
 * Each hook is optional — implement only the phases you need. The `next(ctx)`
 * callback injects typed context that becomes available to the inner handler:
 *
 * - `wrapHandler` — wraps the entire attempt handler. Injected ctx is merged
 *   into `attemptHandler`'s options.
 * - `wrapPrepare` — wraps the user-supplied prepare callback. Injected ctx is
 *   merged into the callback's options alongside the transaction context.
 * - `wrapComplete` — wraps the user-supplied complete callback. Injected ctx is
 *   merged into the callback's options alongside `continueWith`,
 *   `transactionHooks`, and the transaction context.
 *
 * Multiple middleware compose as an onion — the first middleware's "before" runs
 * outermost. Each `next(ctx)` accumulates ctx for inner layers.
 */
export type AttemptMiddleware<
  TStateAdapter extends StateAdapter<BaseTxContext, any> = StateAdapter<BaseTxContext, any>,
  THandlerCtx extends Record<string, unknown> = {},
  TPrepareCtx extends Record<string, unknown> = {},
  TCompleteCtx extends Record<string, unknown> = {},
> = {
  wrapHandler?: <T>(opts: {
    job: RunningJob<TStateAdapter>;
    workerId: string;
    next: (ctx: THandlerCtx) => Promise<T>;
  }) => Promise<T>;
  wrapPrepare?: <T>(
    opts: {
      job: RunningJob<TStateAdapter>;
      next: (ctx: TPrepareCtx) => Promise<T>;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<T>;
  wrapComplete?: <T>(
    opts: {
      job: RunningJob<TStateAdapter>;
      transactionHooks: TransactionHooks;
      next: (ctx: TCompleteCtx) => Promise<T>;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<T>;
};

type AnyJobAttemptMiddleware = AttemptMiddleware<any, any, any, any>;

/** Merge handler-phase ctx from a tuple of {@link AttemptMiddleware}s. Unrolled 4-at-a-time to avoid TS2589 on long tuples. */
export type MergedAttemptHandlerCtx<T extends readonly AnyJobAttemptMiddleware[]> =
  T extends readonly [
    AttemptMiddleware<any, infer A, any, any>,
    AttemptMiddleware<any, infer B, any, any>,
    AttemptMiddleware<any, infer C, any, any>,
    AttemptMiddleware<any, infer D, any, any>,
    ...infer Rest extends readonly AnyJobAttemptMiddleware[],
  ]
    ? A & B & C & D & MergedAttemptHandlerCtx<Rest>
    : T extends readonly [
          AttemptMiddleware<any, infer H, any, any>,
          ...infer Rest extends readonly AnyJobAttemptMiddleware[],
        ]
      ? H & MergedAttemptHandlerCtx<Rest>
      : {};

/** Merge prepare-phase ctx from a tuple of {@link AttemptMiddleware}s. */
export type MergedPrepareCtx<T extends readonly AnyJobAttemptMiddleware[]> = T extends readonly [
  AttemptMiddleware<any, any, infer A, any>,
  AttemptMiddleware<any, any, infer B, any>,
  AttemptMiddleware<any, any, infer C, any>,
  AttemptMiddleware<any, any, infer D, any>,
  ...infer Rest extends readonly AnyJobAttemptMiddleware[],
]
  ? A & B & C & D & MergedPrepareCtx<Rest>
  : T extends readonly [
        AttemptMiddleware<any, any, infer P, any>,
        ...infer Rest extends readonly AnyJobAttemptMiddleware[],
      ]
    ? P & MergedPrepareCtx<Rest>
    : {};

/** Merge complete-phase ctx from a tuple of {@link AttemptMiddleware}s. */
export type MergedCompleteCtx<T extends readonly AnyJobAttemptMiddleware[]> = T extends readonly [
  AttemptMiddleware<any, any, any, infer A>,
  AttemptMiddleware<any, any, any, infer B>,
  AttemptMiddleware<any, any, any, infer C>,
  AttemptMiddleware<any, any, any, infer D>,
  ...infer Rest extends readonly AnyJobAttemptMiddleware[],
]
  ? A & B & C & D & MergedCompleteCtx<Rest>
  : T extends readonly [
        AttemptMiddleware<any, any, any, infer C>,
        ...infer Rest extends readonly AnyJobAttemptMiddleware[],
      ]
    ? C & MergedCompleteCtx<Rest>
    : {};

export const runHandlerMiddlewareChain = async <T>(
  attemptMiddleware: readonly AnyJobAttemptMiddleware[] | undefined,
  baseOpts: { job: unknown; workerId: string },
  innerCallback: (ctx: Record<string, unknown>) => Promise<T>,
): Promise<T> => {
  if (!attemptMiddleware || attemptMiddleware.length === 0) return innerCallback({});
  let chain: (ctx: Record<string, unknown>) => Promise<T> = innerCallback;
  for (let i = attemptMiddleware.length - 1; i >= 0; i--) {
    const middleware = attemptMiddleware[i];
    if (!middleware.wrapHandler) continue;
    const next = chain;
    const wrap = middleware.wrapHandler;
    chain = async (outerCtx) =>
      wrap({
        job: baseOpts.job as any,
        workerId: baseOpts.workerId,
        next: async (addedCtx) => next({ ...outerCtx, ...(addedCtx as Record<string, unknown>) }),
      });
  }
  return chain({});
};

export const runPrepareMiddlewareChain = async <T>(
  attemptMiddleware: readonly AnyJobAttemptMiddleware[] | undefined,
  baseOpts: { job: unknown; txCtx: BaseTxContext },
  innerCallback: (ctx: Record<string, unknown>) => Promise<T>,
): Promise<T> => {
  if (!attemptMiddleware || attemptMiddleware.length === 0) return innerCallback({});
  let chain: (ctx: Record<string, unknown>) => Promise<T> = innerCallback;
  for (let i = attemptMiddleware.length - 1; i >= 0; i--) {
    const middleware = attemptMiddleware[i];
    if (!middleware.wrapPrepare) continue;
    const next = chain;
    const wrap = middleware.wrapPrepare;
    chain = async (outerCtx) =>
      wrap({
        job: baseOpts.job as any,
        ...(baseOpts.txCtx as any),
        next: async (addedCtx) => next({ ...outerCtx, ...(addedCtx as Record<string, unknown>) }),
      });
  }
  return chain({});
};

export const runCompleteMiddlewareChain = async <T>(
  attemptMiddleware: readonly AnyJobAttemptMiddleware[] | undefined,
  baseOpts: { job: unknown; transactionHooks: TransactionHooks; txCtx: BaseTxContext },
  innerCallback: (ctx: Record<string, unknown>) => Promise<T>,
): Promise<T> => {
  if (!attemptMiddleware || attemptMiddleware.length === 0) return innerCallback({});
  let chain: (ctx: Record<string, unknown>) => Promise<T> = innerCallback;
  for (let i = attemptMiddleware.length - 1; i >= 0; i--) {
    const middleware = attemptMiddleware[i];
    if (!middleware.wrapComplete) continue;
    const next = chain;
    const wrap = middleware.wrapComplete;
    chain = async (outerCtx) =>
      wrap({
        job: baseOpts.job as any,
        transactionHooks: baseOpts.transactionHooks,
        ...(baseOpts.txCtx as any),
        next: async (addedCtx) => next({ ...outerCtx, ...(addedCtx as Record<string, unknown>) }),
      });
  }
  return chain({});
};
