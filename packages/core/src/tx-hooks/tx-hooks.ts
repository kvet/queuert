import { createResettableLatch } from "@queuert/helpers/latch";
import { type MaybePromise, isPromise, tryCatch, tryFinally } from "@queuert/helpers/maybe-promise";
import { silence } from "@queuert/helpers/promise";

import { HookRegistry } from "./hook-registry.ts";

type CommitCallback = () => void | Promise<void>;

/**
 * Buffers transaction side effects and controls their lifecycle.
 *
 * Callbacks registered with `onCommit` run only after the caller's transaction commits; callbacks
 * registered with `onRollback` run if the work they were registered in is rolled back. Each
 * callback belongs to the innermost savepoint or `retryBoundary` try that was open when it was
 * registered. Once the hooks are flushed or discarded, registering a callback, savepoints and
 * `retryBoundary` tries throw, and rolling back an earlier savepoint does nothing.
 *
 * The hooks follow the transaction they wrap: when its callback returns a promise, commit
 * callbacks may return promises too and `flush` awaits them; when it returns a plain value, as in
 * a driver's own synchronous transaction, commit callbacks must be synchronous.
 */
export type TxHooks = {
  /**
   * Run `callback` after the transaction commits.
   *
   * Commit callbacks start in registration order and run concurrently: a returned promise is
   * awaited by `flush`, but not before the next callback starts. Every callback runs even if an
   * earlier one throws, and `flush` then rethrows the first error. A callback registered in a
   * savepoint or `retryBoundary` try that is rolled back never runs. In a synchronous
   * transaction, a callback that returns a promise makes the flush throw after every callback has
   * run.
   */
  onCommit(callback: () => void | Promise<void>): void;
  /**
   * Run `callback` if the work it was registered in is rolled back: the savepoint or
   * `retryBoundary` try open at registration, or the whole transaction when the hooks are
   * discarded.
   *
   * Rollback callbacks run newest first. They must be synchronous: a returned promise is not
   * awaited. Every callback runs even if an earlier one throws; `discard` rethrows the first
   * error, while a savepoint or `retryBoundary` rollback ignores it.
   */
  onRollback(callback: () => void): void;
  /**
   * Run `fn` inside a savepoint and return its result. Rolls back if `fn` throws or the promise it
   * returns rejects, and releases otherwise.
   */
  withSavepoint<T>(fn: (txHooks: TxHooks) => T): T;
  /**
   * Create a manual savepoint. `rollback()` drops the commit callbacks registered since and runs
   * the rollback callbacks registered since; `release()` keeps them.
   */
  createSavepoint(): TxHooksSavepoint;
  /**
   * Wrap a transaction callback that a driver or retry loop may call more than once, such as
   * the callback of MongoDB's `session.withTransaction`.
   *
   * Each call after the first rolls back what the previous try registered, then calls `fn` with
   * the same arguments and returns its result. Callbacks registered before the first call are
   * kept.
   * A call while the previous call's `fn` is still running throws, or rejects when that `fn`
   * returned a promise. Create one wrapper per transaction: every call after the first is
   * treated as a rerun of the same transaction.
   */
  retryBoundary<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult;
};

/** A savepoint handle with manual rollback/release control. */
export type TxHooksSavepoint = {
  txHooks: TxHooks;
  rollback(): void;
  release(): void;
};

/**
 * A {@link TxHooks} instance with `flush` and `discard` lifecycle methods.
 *
 * - Call `flush()` after the transaction commits to run the commit callbacks. It returns a promise
 *   only when a commit callback returned one.
 * - Call `discard()` on rollback to run the rollback callbacks instead.
 */
export type TxHooksHandle = {
  txHooks: TxHooks;
  flush: () => void | Promise<void>;
  discard: () => void;
};

const runCommitCallback = (callback: CommitCallback): unknown => {
  try {
    return callback();
  } catch (error) {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- re-rejecting a caught error
    return Promise.reject(error);
  }
};

const throwFirstRejection = (results: PromiseSettledResult<unknown>[]): void => {
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
  if (failed) throw failed.reason;
};

const flushAsync = (registry: HookRegistry<CommitCallback>): void | Promise<void> => {
  const results = registry.takeCommitCallbacks().map(runCommitCallback);
  const pending = results.filter(isPromise);
  if (pending.length === 0) return;
  if (pending.length === 1) return pending[0].then(() => {});
  return Promise.allSettled(results).then(throwFirstRejection);
};

const flushSync = (registry: HookRegistry<CommitCallback>): void => {
  let failure: { error: unknown } | undefined;
  let returnedPromise = false;
  for (const callback of registry.takeCommitCallbacks()) {
    try {
      const result: unknown = callback();
      if (isPromise(result)) {
        returnedPromise = true;
        silence(result);
      }
    } catch (error) {
      failure ??= { error };
    }
  }
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
  if (failure) throw failure.error;
  if (returnedPromise) {
    throw new Error(
      "txHooks of a synchronous transaction require synchronous commit callbacks: a commit callback returned a promise",
    );
  }
};

class TxHooksRegistry extends HookRegistry<CommitCallback> implements TxHooks {
  createSavepoint(): TxHooksSavepoint {
    return { txHooks: this, rollback: this.snapshot(), release: () => {} };
  }

  withSavepoint<T>(fn: (txHooks: TxHooks) => T): T {
    const rollback = this.snapshot();
    return tryCatch(
      () => fn(this) as MaybePromise<unknown>,
      (error) => {
        rollback();
        // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
        throw error;
      },
    ) as T;
  }

  retryBoundary<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    let rollbackPreviousTry: (() => void) | undefined;
    let previousTryReturnedPromise = false;
    const running = createResettableLatch(
      "txHooks.retryBoundary: the previous try is still running",
    );
    return (...args) => {
      if (running.tripped && previousTryReturnedPromise) {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the latch error is an Error
        return Promise.reject(
          new Error("txHooks.retryBoundary: the previous try is still running"),
        ) as TResult;
      }
      running.throwIfTripped();
      rollbackPreviousTry?.();
      rollbackPreviousTry = this.snapshot();
      running.trip();
      const result = tryFinally(
        () => fn(...args) as MaybePromise<unknown>,
        () => {
          running.reset();
        },
      );
      previousTryReturnedPromise = isPromise(result);
      return result as TResult;
    };
  }
}

/**
 * Create a new tx hooks handle.
 *
 * Returns `txHooks` (carried in a state provider's transaction context, where the provider's
 * `onTransactionCommit` and `onTransactionRollback` register on them), `flush` (call after
 * commit), and `discard` (call on rollback).
 */
export const createTxHooks = (): TxHooksHandle => {
  const txHooks = new TxHooksRegistry();
  return {
    txHooks,
    flush: () => flushAsync(txHooks),
    discard: () => {
      txHooks.discard();
    },
  };
};

const discardQuietly = (txHooks: TxHooksRegistry): void => {
  try {
    txHooks.discard();
  } catch {}
};

/**
 * Execute a callback with auto-managed tx hooks. Flushes on success, discards on error.
 *
 * Wrap the transaction from outside, so the hooks flush after COMMIT. A state provider without
 * transaction events of its own calls it in `withTransaction`; open your own transaction inside it
 * and pass `txHooks` in the transaction context.
 *
 * When `cb` returns a promise, `withTxHooks` returns a promise that settles after the commit
 * callbacks. When `cb` returns a plain value, as a driver's own synchronous transaction does, the
 * commit callbacks run synchronously and `withTxHooks` returns the value; a commit callback that
 * returns a promise then makes it throw after every callback has run.
 */
export const withTxHooks = <T>(cb: (txHooks: TxHooks) => T): T => {
  const txHooks = new TxHooksRegistry();
  let result: T;
  try {
    result = cb(txHooks);
  } catch (error) {
    discardQuietly(txHooks);
    throw error;
  }
  if (!isPromise(result)) {
    flushSync(txHooks);
    return result;
  }
  return result.then(
    async (value) => {
      await flushAsync(txHooks);
      return value;
    },
    (error: unknown) => {
      discardQuietly(txHooks);
      throw error;
    },
  ) as T;
};
