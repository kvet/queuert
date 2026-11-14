import {
  andThen,
  isPromise,
  isThenable,
  type MaybePromise,
  silence,
  tryCatch,
  tryFinally,
} from "@queuert/sync-async";

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

const settledMessage =
  "txHooks were already flushed or discarded; open new tx hooks for a new transaction";

const runningMessage = "txHooks.retryBoundary: the previous try is still running";

const runEach = (
  callbacks: (() => unknown)[],
): { failure: { error: unknown } | undefined; returnedPromise: boolean } => {
  let failure: { error: unknown } | undefined;
  let returnedPromise = false;
  for (const callback of callbacks) {
    try {
      const result = callback();
      if (isThenable(result)) {
        returnedPromise = true;
        silence(result);
      }
    } catch (error) {
      failure ??= { error };
    }
  }
  return { failure, returnedPromise };
};

class TxHooksRegistry implements TxHooks {
  private readonly commits: CommitCallback[] = [];
  private readonly rollbacks: (() => unknown)[] = [];
  private open: { commit: number; rollback: number }[] | undefined;
  private settled = false;

  onCommit(callback: CommitCallback): void {
    if (this.settled) throw new Error(settledMessage);
    this.commits.push(callback);
  }

  onRollback(callback: () => void): void {
    if (this.settled) throw new Error(settledMessage);
    this.rollbacks.push(callback);
  }

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
    let running = false;
    let previousTryReturnedPromise = false;
    return (...args) => {
      if (running) {
        const error = new Error(runningMessage);
        if (previousTryReturnedPromise) return Promise.reject(error) as TResult;
        throw error;
      }
      rollbackPreviousTry?.();
      rollbackPreviousTry = this.snapshot();
      running = true;
      const result = tryFinally(
        () => fn(...args) as MaybePromise<unknown>,
        () => {
          running = false;
        },
      );
      previousTryReturnedPromise = isPromise(result);
      return result as TResult;
    };
  }

  flushSync(): void {
    if (this.settled) return;
    this.settled = true;
    const { failure, returnedPromise } = runEach(this.commits);
    this.commits.length = 0;
    this.rollbacks.length = 0;
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (failure) throw failure.error;
    if (returnedPromise) {
      throw new Error(
        "txHooks of a synchronous transaction require synchronous commit callbacks: a commit callback returned a promise",
      );
    }
  }

  flush(): void | Promise<void> {
    if (this.settled) return;
    this.settled = true;
    if (this.commits.length === 0) return;
    let failure: { error: unknown } | undefined;
    let pending: Promise<unknown>[] | undefined;
    for (const callback of this.commits) {
      try {
        const result = callback();
        if (isPromise(result)) (pending ??= []).push(result);
      } catch (error) {
        failure ??= { error };
      }
    }
    this.commits.length = 0;
    this.rollbacks.length = 0;
    if (pending === undefined) {
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
      if (failure) throw failure.error;
      return;
    }
    if (pending.length === 1 && failure === undefined) return pending[0].then(() => {});
    return Promise.allSettled(pending).then((outcomes) => {
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
      if (failure) throw failure.error;
      const failed = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
      if (failed) throw failed.reason;
    });
  }

  discard(): void {
    if (this.settled) return;
    this.settled = true;
    let failure: { error: unknown } | undefined;
    for (let i = this.rollbacks.length - 1; i >= 0; i--) {
      try {
        const result: unknown = this.rollbacks[i]();
        if (isThenable(result)) silence(result);
      } catch (error) {
        failure ??= { error };
      }
    }
    this.commits.length = 0;
    this.rollbacks.length = 0;
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (failure) throw failure.error;
  }

  private snapshot(): () => void {
    if (this.settled) throw new Error(settledMessage);
    const mark = { commit: this.commits.length, rollback: this.rollbacks.length };
    (this.open ??= []).push(mark);
    return () => {
      const depth = this.open!.indexOf(mark);
      if (this.settled || depth === -1) return;
      this.open!.length = depth + 1;
      this.commits.length = mark.commit;
      runEach(this.rollbacks.splice(mark.rollback).toReversed());
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
    flush: () => txHooks.flush(),
    discard: () => {
      txHooks.discard();
    },
  };
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
    try {
      txHooks.discard();
    } catch {}
    throw error;
  }
  if (!isPromise(result)) {
    txHooks.flushSync();
    return result;
  }
  return result.then(
    (value) => andThen(txHooks.flush(), () => value),
    (error: unknown) => {
      try {
        txHooks.discard();
      } catch {}
      throw error;
    },
  ) as T;
};
