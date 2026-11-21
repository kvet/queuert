import {
  andThen,
  isPromise,
  type MaybePromise,
  silence,
  tryCatch,
  tryFinally,
} from "@queuert/sync-async";

/**
 * Buffers transaction side effects and controls their lifecycle.
 *
 * Callbacks registered with `onCommit` run only after the caller's transaction commits; callbacks
 * registered with `onRollback` run if the work they were registered in is rolled back. Each
 * callback belongs to the innermost savepoint or `retryBoundary` try that was open when it was
 * registered. Once the hooks are flushed or discarded, registering a callback, savepoints and
 * `retryBoundary` tries throw, and rolling back an earlier savepoint does nothing.
 *
 * The hooks follow the transaction they wrap: when its callback returns a promise, commit and
 * rollback callbacks may return promises too and `flush` or `discard` awaits them; when it returns a
 * plain value, as in a driver's own synchronous transaction, they must be synchronous.
 */
export type TxHooks = {
  /**
   * Whether the transaction these hooks belong to is still open: `true` until the hooks are flushed
   * or discarded, through savepoint and `retryBoundary` rollbacks, and `false` from then on,
   * including in the commit and rollback callbacks the flush or discard runs. A state provider whose
   * driver cannot tell a finished transaction from an open one reads it in `getTransaction`.
   */
  readonly isOpen: boolean;
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
   * Rollback callbacks start newest first and run concurrently: a returned promise is awaited by
   * the `flush` or `discard` that ends the transaction. Every callback runs even if an earlier one
   * throws; `discard` rethrows the first error, while a savepoint or `retryBoundary` rollback
   * ignores it. In a synchronous transaction they must be synchronous: a promise returned on a
   * savepoint or `retryBoundary` rollback makes the flush throw.
   */
  onRollback(callback: () => void | Promise<void>): void;
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
 * - Call `flush()` after the transaction commits to run the commit callbacks.
 * - Call `discard()` on rollback to run the rollback callbacks instead.
 *
 * Each returns a promise only when a callback it runs, or one a savepoint rollback ran, returned
 * one.
 */
export type TxHooksHandle = {
  txHooks: TxHooks;
  flush: () => void | Promise<void>;
  discard: () => void | Promise<void>;
};

type Callback = () => void | Promise<void>;

type Outcome = {
  failure: { error: unknown } | undefined;
  pending: Promise<unknown>[] | undefined;
};

const settledMessage =
  "txHooks were already flushed or discarded; open new tx hooks for a new transaction";

const runningMessage = "txHooks.retryBoundary: the previous try is still running";

const synchronousMessage = (kind: "commit" | "rollback"): string =>
  `txHooks of a synchronous transaction require synchronous ${kind} callbacks: a ${kind} callback returned a promise`;

const run = (callbacks: readonly Callback[], newestFirst: boolean): Outcome => {
  let failure: Outcome["failure"];
  let pending: Outcome["pending"];
  const last = callbacks.length - 1;
  for (let i = 0; i <= last; i++) {
    try {
      const result = callbacks[newestFirst ? last - i : i]();
      if (isPromise(result)) (pending ??= []).push(result);
    } catch (error) {
      failure ??= { error };
    }
  }
  return { failure, pending };
};

const conclude = (
  { failure, pending }: Outcome,
  rolledBack: Promise<unknown>[] | undefined,
): void | Promise<void> => {
  if (pending === undefined && rolledBack === undefined) {
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (failure) throw failure.error;
    return;
  }
  if (rolledBack === undefined && failure === undefined && pending!.length === 1) {
    return pending![0].then(() => {});
  }
  return Promise.all([
    Promise.allSettled(pending ?? []),
    Promise.allSettled(rolledBack ?? []),
  ]).then(([outcomes]) => {
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (failure) throw failure.error;
    const rejected = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (rejected) throw rejected.reason;
  });
};

class TxHooksRegistry implements TxHooks {
  private readonly commits: Callback[] = [];
  private readonly rollbacks: Callback[] = [];
  private rolledBack: Promise<unknown>[] | undefined;
  private marks: { commits: number; rollbacks: number }[] | undefined;
  private settled = false;

  get isOpen(): boolean {
    return !this.settled;
  }

  onCommit(callback: Callback): void {
    if (this.settled) throw new Error(settledMessage);
    this.commits.push(callback);
  }

  onRollback(callback: Callback): void {
    if (this.settled) throw new Error(settledMessage);
    this.rollbacks.push(callback);
  }

  createSavepoint(): TxHooksSavepoint {
    return { txHooks: this, rollback: this.mark(), release: () => {} };
  }

  withSavepoint<T>(fn: (txHooks: TxHooks) => T): T {
    const rollback = this.mark();
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
      rollbackPreviousTry = this.mark();
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

  flush(): void | Promise<void> {
    if (this.settled) return;
    this.settled = true;
    if (this.commits.length === 0 && this.rolledBack === undefined) return;
    const outcome = run(this.commits, false);
    return conclude(outcome, this.clear());
  }

  flushSync(): void {
    if (this.settled) return;
    this.settled = true;
    const { failure, pending } = run(this.commits, false);
    const rolledBack = this.clear();
    for (const promise of pending ?? []) silence(promise);
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (failure) throw failure.error;
    if (pending !== undefined) throw new Error(synchronousMessage("commit"));
    if (rolledBack !== undefined) throw new Error(synchronousMessage("rollback"));
  }

  discard(): void | Promise<void> {
    if (this.settled) return;
    this.settled = true;
    const outcome = run(this.rollbacks, true);
    return conclude(outcome, this.clear());
  }

  private clear(): Promise<unknown>[] | undefined {
    const rolledBack = this.rolledBack;
    this.commits.length = 0;
    this.rollbacks.length = 0;
    this.rolledBack = undefined;
    this.marks = undefined;
    return rolledBack;
  }

  private mark(): () => void {
    if (this.settled) throw new Error(settledMessage);
    const mark = { commits: this.commits.length, rollbacks: this.rollbacks.length };
    (this.marks ??= []).push(mark);
    return () => {
      const depth = this.marks?.indexOf(mark) ?? -1;
      if (this.settled || depth === -1) return;
      this.marks!.length = depth + 1;
      this.commits.length = mark.commits;
      const { pending } = run(this.rollbacks.splice(mark.rollbacks), true);
      for (const promise of pending ?? []) {
        silence(promise);
        (this.rolledBack ??= []).push(promise);
      }
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
    discard: () => txHooks.discard(),
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
 * callbacks, or, when it rejects, after the rollback callbacks. When `cb` returns a plain value, as
 * a driver's own synchronous transaction does, the commit callbacks run synchronously and
 * `withTxHooks` returns the value; a commit callback that returns a promise then makes it throw
 * after every callback has run, and so does a rollback callback that returned one when a savepoint
 * rolled back.
 */
export const withTxHooks = <T>(cb: (txHooks: TxHooks) => T): T => {
  const txHooks = new TxHooksRegistry();
  let result: T;
  try {
    result = cb(txHooks);
  } catch (error) {
    try {
      const discarded = txHooks.discard();
      if (isPromise(discarded)) silence(discarded);
    } catch {}
    throw error;
  }
  if (!isPromise(result)) {
    txHooks.flushSync();
    return result;
  }
  return result.then(
    (value) => andThen(txHooks.flush(), () => value),
    async (error: unknown) => {
      try {
        await txHooks.discard();
      } catch {}
      throw error;
    },
  ) as T;
};
