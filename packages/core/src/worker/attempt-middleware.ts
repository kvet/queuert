import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import { type ResolvedRunningJob } from "../entities/job-types.resolvers.js";
import { type GetStateAdapterJobId, type StateAdapter } from "../state-adapter/state-adapter.js";

type RunningJob<TStateAdapter extends StateAdapter<any, any>> = ResolvedRunningJob<
  GetStateAdapterJobId<TStateAdapter>,
  BaseJobTypeDefinitions,
  string,
  string
>;

/**
 * Wraps job processing with cross-cutting logic.
 *
 * `wrapHandler` wraps the entire attempt handler. The `next(ctx)` callback injects typed
 * context that is merged into `attemptHandler`'s options. It must return what `next`
 * returned — the handler's `finish` result.
 *
 * Multiple middleware compose as an onion — the first middleware's "before" runs
 * outermost. Each `next(ctx)` accumulates ctx for inner layers.
 */
export type AttemptMiddleware<
  TStateAdapter extends StateAdapter<any, any>,
  THandlerCtx extends Record<string, unknown> = Record<string, unknown>,
> = {
  wrapHandler?: <T>(opts: {
    job: RunningJob<TStateAdapter>;
    workerId: string;
    next: (ctx: THandlerCtx) => Promise<T>;
  }) => Promise<T>;
};

/**
 * Wildcard {@link AttemptMiddleware} used wherever a middleware tuple is
 * constrained.
 *
 * The state adapter slot is `StateAdapter<any, any>` rather than `any`: with a
 * bare `any`, `GetStateAdapterJobId` resolves to its branch union (`string`)
 * instead of `any`, which makes middleware typed with a *concrete* adapter fail
 * assignability to the wildcard — silently collapsing the merged ctx of
 * multi-element tuples to `unknown`.
 * @internal
 */
export type AnyAttemptMiddleware = AttemptMiddleware<StateAdapter<any, any>, any>;

/** Merge handler ctx from a tuple of {@link AttemptMiddleware}s. */
export type MergedAttemptHandlerCtx<T extends readonly AnyAttemptMiddleware[]> =
  T extends readonly [
    AttemptMiddleware<any, infer H>,
    ...infer Rest extends readonly AnyAttemptMiddleware[],
  ]
    ? H & MergedAttemptHandlerCtx<Rest>
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
