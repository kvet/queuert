import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type ResolvedJobWithBlockers } from "../entities/job-types.resolvers.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

type RunningJob<TStateAdapter extends StateAdapter<any, any>> = ResolvedJobWithBlockers<
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
 * - `wrapStep` — wraps each user-supplied step callback. Injected ctx is
 *   merged into the callback's options alongside `transactionHooks` and the
 *   transaction context.
 * - `wrapComplete` — wraps the user-supplied complete callback. Injected ctx is
 *   merged into the callback's options alongside `finish`,
 *   `transactionHooks`, and the transaction context.
 *
 * Multiple middleware compose as an onion — the first middleware's "before" runs
 * outermost. Each `next(ctx)` accumulates ctx for inner layers.
 */
export type AttemptMiddleware<
  TStateAdapter extends StateAdapter<any, any>,
  THandlerCtx extends Record<string, unknown> = Record<string, unknown>,
  TPrepareCtx extends Record<string, unknown> = Record<string, unknown>,
  TStepCtx extends Record<string, unknown> = Record<string, unknown>,
  TCompleteCtx extends Record<string, unknown> = Record<string, unknown>,
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
  wrapStep?: <T>(
    opts: {
      job: RunningJob<TStateAdapter>;
      transactionHooks: TransactionHooks;
      next: (ctx: TStepCtx) => Promise<T>;
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

/**
 * Wildcard {@link AttemptMiddleware} used wherever a middleware tuple is
 * constrained.
 *
 * The state adapter slot is `StateAdapter<any, any>` rather than `any`: with a
 * bare `any`, `GetStateAdapterJobId` / `GetStateAdapterTxContext` resolve to
 * their branch union (`string` / `never`) instead of `any`, which makes
 * middleware typed with a *concrete* adapter fail assignability to the wildcard
 * — silently collapsing the merged ctx of multi-element tuples to `unknown`.
 * @internal
 */
export type AnyAttemptMiddleware = AttemptMiddleware<StateAdapter<any, any>, any, any, any, any>;

/** Merge handler-phase ctx from a tuple of {@link AttemptMiddleware}s. */
export type MergedAttemptHandlerCtx<T extends readonly AnyAttemptMiddleware[]> =
  T extends readonly [
    AttemptMiddleware<any, infer H, any, any, any>,
    ...infer Rest extends readonly AnyAttemptMiddleware[],
  ]
    ? H & MergedAttemptHandlerCtx<Rest>
    : unknown;

/** Merge prepare-phase ctx from a tuple of {@link AttemptMiddleware}s. */
export type MergedPrepareCtx<T extends readonly AnyAttemptMiddleware[]> = T extends readonly [
  AttemptMiddleware<any, any, infer P, any, any>,
  ...infer Rest extends readonly AnyAttemptMiddleware[],
]
  ? P & MergedPrepareCtx<Rest>
  : unknown;

/** Merge step-phase ctx from a tuple of {@link AttemptMiddleware}s. */
export type MergedStepCtx<T extends readonly AnyAttemptMiddleware[]> = T extends readonly [
  AttemptMiddleware<any, any, any, infer E, any>,
  ...infer Rest extends readonly AnyAttemptMiddleware[],
]
  ? E & MergedStepCtx<Rest>
  : unknown;

/** Merge complete-phase ctx from a tuple of {@link AttemptMiddleware}s. */
export type MergedCompleteCtx<T extends readonly AnyAttemptMiddleware[]> = T extends readonly [
  AttemptMiddleware<any, any, any, any, infer C>,
  ...infer Rest extends readonly AnyAttemptMiddleware[],
]
  ? C & MergedCompleteCtx<Rest>
  : unknown;

/** Bidirectional assignability check used for middleware tuple identity. @internal */
type TypesEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Checks whether `TReq` appears as an in-order subsequence within `TMW`
 * (by type identity). Required middleware must appear in the declared order,
 * but arbitrary other middleware may be interleaved before, between, or after.
 *
 * Type identity is structural — two structurally identical middleware values
 * are indistinguishable here. Runtime `===` is the source of truth; this type
 * is a strong early signal, not a guarantee.
 * @internal
 */
export type IsAttemptMiddlewareSubsequence<
  TReq extends readonly AnyAttemptMiddleware[],
  TMW extends readonly AnyAttemptMiddleware[],
> = TReq extends readonly []
  ? true
  : TMW extends readonly [infer H, ...infer Rest]
    ? TReq extends readonly [infer R, ...infer ReqRest]
      ? TypesEqual<H, R> extends true
        ? ReqRest extends readonly AnyAttemptMiddleware[]
          ? Rest extends readonly AnyAttemptMiddleware[]
            ? IsAttemptMiddlewareSubsequence<ReqRest, Rest>
            : false
          : false
        : Rest extends readonly AnyAttemptMiddleware[]
          ? IsAttemptMiddlewareSubsequence<TReq, Rest>
          : false
      : true
    : false;

export const runHandlerMiddlewareChain = async <T>(
  attemptMiddleware: readonly AnyAttemptMiddleware[] | undefined,
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
        next: async (addedCtx: Record<string, unknown>) => next({ ...outerCtx, ...addedCtx }),
      });
  }
  return chain({});
};

export const runPrepareMiddlewareChain = async <T>(
  attemptMiddleware: readonly AnyAttemptMiddleware[] | undefined,
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
        next: async (addedCtx: Record<string, unknown>) => next({ ...outerCtx, ...addedCtx }),
      });
  }
  return chain({});
};

export const runStepMiddlewareChain = async <T>(
  attemptMiddleware: readonly AnyAttemptMiddleware[] | undefined,
  baseOpts: { job: unknown; transactionHooks: TransactionHooks; txCtx: BaseTxContext },
  innerCallback: (ctx: Record<string, unknown>) => Promise<T>,
): Promise<T> => {
  if (!attemptMiddleware || attemptMiddleware.length === 0) return innerCallback({});
  let chain: (ctx: Record<string, unknown>) => Promise<T> = innerCallback;
  for (let i = attemptMiddleware.length - 1; i >= 0; i--) {
    const middleware = attemptMiddleware[i];
    if (!middleware.wrapStep) continue;
    const next = chain;
    const wrap = middleware.wrapStep;
    chain = async (outerCtx) =>
      wrap({
        job: baseOpts.job as any,
        transactionHooks: baseOpts.transactionHooks,
        ...(baseOpts.txCtx as any),
        next: async (addedCtx: Record<string, unknown>) => next({ ...outerCtx, ...addedCtx }),
      });
  }
  return chain({});
};

export const runCompleteMiddlewareChain = async <T>(
  attemptMiddleware: readonly AnyAttemptMiddleware[] | undefined,
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
        next: async (addedCtx: Record<string, unknown>) => next({ ...outerCtx, ...addedCtx }),
      });
  }
  return chain({});
};
