import { createResettableLatch, isThenable, noop } from "@queuert/helpers";

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
 */
export type TxHooks = {
  /**
   * Run `callback` after the transaction commits.
   *
   * Commit callbacks start in registration order and run concurrently: a returned promise is
   * awaited by `flush`, but not before the next callback starts. Every callback runs even if an
   * earlier one throws, and `flush` then rethrows the first error. A callback registered in a
   * savepoint or `retryBoundary` try that is rolled back never runs.
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
  /** Run `fn` inside a savepoint. Auto-rollback on error, auto-release on success. */
  withSavepoint<T>(fn: (txHooks: TxHooks) => T | Promise<T>): Promise<T>;
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
   * A call while the previous call's `fn` is still running rejects. Create one wrapper per
   * transaction: every call after the first is treated as a rerun of the same transaction.
   */
  retryBoundary<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
  ): (...args: TArgs) => Promise<TResult>;
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
 * - Call `flush()` after the transaction commits to run the commit callbacks.
 * - Call `discard()` on rollback to run the rollback callbacks instead.
 */
export type TxHooksHandle = {
  txHooks: TxHooks;
  flush: () => Promise<void>;
  discard: () => void;
};

class AsyncTxHooks extends HookRegistry<CommitCallback> implements TxHooks {
  createSavepoint(): TxHooksSavepoint {
    return { txHooks: this, rollback: this.snapshot(), release: () => {} };
  }

  async withSavepoint<T>(fn: (txHooks: TxHooks) => T | Promise<T>): Promise<T> {
    const rollback = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      rollback();
      throw error;
    }
  }

  retryBoundary<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
  ): (...args: TArgs) => Promise<TResult> {
    let rollbackPreviousTry: (() => void) | undefined;
    const running = createResettableLatch(
      "txHooks.retryBoundary: the previous try is still running",
    );
    return async (...args) => {
      running.throwIfTripped();
      rollbackPreviousTry?.();
      rollbackPreviousTry = this.snapshot();
      running.trip();
      try {
        return await fn(...args);
      } finally {
        running.reset();
      }
    };
  }
}

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

const flushHooks = (registry: AsyncTxHooks): Promise<void> | undefined => {
  const results = registry.takeCommitCallbacks().map(runCommitCallback);
  const pending = results.filter(isThenable);
  if (pending.length === 0) return undefined;
  if (pending.length === 1) return Promise.resolve(pending[0]).then(noop);
  return Promise.allSettled(results).then(throwFirstRejection);
};

/**
 * Create a new tx hooks handle.
 *
 * Returns `txHooks` (pass to mutating client methods), `flush` (call after commit),
 * and `discard` (call on rollback).
 */
export const createTxHooks = (): TxHooksHandle => {
  const txHooks = new AsyncTxHooks();
  return {
    txHooks,
    flush: async () => flushHooks(txHooks),
    discard: () => {
      txHooks.discard();
    },
  };
};

/** Execute a callback with auto-managed tx hooks. Flushes on success, discards on error. */
export const withTxHooks = async <T>(cb: (txHooks: TxHooks) => Promise<T>): Promise<T> => {
  const txHooks = new AsyncTxHooks();
  try {
    const result = await cb(txHooks);
    const flushing = flushHooks(txHooks);
    if (flushing !== undefined) await flushing;
    return result;
  } catch (error) {
    try {
      txHooks.discard();
    } catch {}
    throw error;
  }
};
