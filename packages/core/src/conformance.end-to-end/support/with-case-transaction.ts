import type { MaybePromise } from "@queuert/helpers/maybe-promise";
import type { Steps } from "@queuert/helpers/steps";

import { type ConformanceStateAdapter, inTransaction } from "../../conformance/adapters.ts";
import type { EndToEndTxContext } from "../types.ts";

/** The value a transaction body resolves to: a generator's return value, or the awaited result. */
type CaseTransactionResult<R> = R extends Steps<infer T> ? T : Awaited<R>;

/**
 * Runs `callback` in a transaction of the case's adapter, in its mode: return the call's result
 * directly, or write a generator body with `yield* step(value)` where `await value` would stand.
 * The result type comes from the callback's return type, so a body returning one of several
 * promises (`cond ? complete(a) : complete(b)`) resolves to their union.
 */
export const withCaseTransaction = <R>(
  stateAdapter: ConformanceStateAdapter,
  callback: (txCtx: EndToEndTxContext) => R,
): MaybePromise<CaseTransactionResult<R>> =>
  inTransaction(stateAdapter, callback) as MaybePromise<CaseTransactionResult<R>>;
