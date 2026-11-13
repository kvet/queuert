import type { MaybePromise } from "@queuert/helpers/maybe-promise";
import { isThenable } from "@queuert/helpers/promise";
import { isSteps, runSteps, type Steps } from "@queuert/helpers/steps";

import { type AdapterMode, isSyncAdapter } from "../adapter-mode.ts";
import type { NotifyAdapterOperations } from "../notify-adapter/notify-adapter.ts";
import type { StateAdapterOperations } from "../state-adapter/state-adapter.ts";

/**
 * A state adapter of either mode, as the conformance cases see it: its methods return plain
 * values on a sync adapter and promises on an async one, and the cases check this against its
 * `sync` marker. {@link StateAdapter} and {@link SyncStateAdapter} both fit it.
 */
export type ConformanceStateAdapter = StateAdapterOperations<any, any, any, AdapterMode> & {
  /** Set on a sync adapter. */
  readonly sync?: true;
  close(): MaybePromise<void>;
} & (AsyncDisposable | Disposable);

/**
 * A notify adapter of either mode, as the conformance cases see it: its methods return plain
 * values on a sync adapter and promises on an async one.
 */
export type ConformanceNotifyAdapter = NotifyAdapterOperations<AdapterMode> & {
  /** Set on a sync adapter. */
  readonly sync?: true;
  close(): MaybePromise<void>;
} & (AsyncDisposable | Disposable);

const runPromiseSteps = async <T>(steps: Steps<T>): Promise<T> => {
  let violation: Error | undefined;
  let result = steps.next();
  while (result.done !== true) {
    const yielded = result.value;
    if (!isThenable(yielded)) {
      violation ??= new Error(
        "An asynchronous step got a plain value: the value must be a promise",
      );
      result = steps.throw(violation);
      continue;
    }
    let value: unknown;
    try {
      value = await yielded;
    } catch (error) {
      result = steps.throw(error);
      continue;
    }
    result = steps.next(value);
  }
  if (violation !== undefined) throw violation;
  return result.value;
};

const runInMode = <T>(steps: Steps<T>, sync: boolean): MaybePromise<T> =>
  sync ? runSteps(steps, true) : runPromiseSteps(steps);

/**
 * Runs `fn` in a transaction of `stateAdapter`, in its mode. `fn` either returns the adapter's
 * result directly, such as `(txCtx) => stateAdapter.createJobs({ txCtx, ... })`, or is a generator
 * whose `yield* step(value)` stands where `await value` would, so one body runs synchronously
 * over a sync adapter and awaits over an async one. Over an async adapter, every step must be a
 * promise.
 */
export const inTransaction = <T>(
  stateAdapter: ConformanceStateAdapter,
  fn: (txCtx: any) => MaybePromise<T> | Steps<T>,
): MaybePromise<T> =>
  stateAdapter.withTransaction((txCtx) => {
    const body = fn(txCtx);
    return isSteps(body) ? runInMode(body, isSyncAdapter(stateAdapter)) : body;
  });

/**
 * Runs a generator body in the adapter's mode, outside a transaction: synchronously over a sync
 * adapter, awaiting each `yield* step(value)` over an async one, where every step must be a
 * promise.
 */
export const inMode = <TAdapter extends object, T>(
  adapter: TAdapter,
  body: () => Steps<T>,
): InModeResult<TAdapter, T> =>
  runInMode(body(), isSyncAdapter(adapter)) as InModeResult<TAdapter, T>;

/**
 * What {@link inMode} returns for an adapter of this type: a plain value for a sync adapter, a
 * promise for an async one, and either for a {@link ConformanceStateAdapter} or
 * {@link ConformanceNotifyAdapter}, whose mode is known only at runtime.
 */
type InModeResult<TAdapter, T> = TAdapter extends { readonly sync: true }
  ? T
  : "sync" extends keyof TAdapter
    ? MaybePromise<T>
    : Promise<T>;
