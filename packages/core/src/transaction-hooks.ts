import { HookNotRegisteredError } from "./errors.js";

export type HookDefinition<T> = {
  state: T;
  flush: (state: T) => void | Promise<void>;
  discard?: (state: T) => void | Promise<void>;
  checkpoint?: (state: T) => () => void;
};

/**
 * Buffers transaction side effects and controls their lifecycle.
 *
 * Side effects (notifications, observability, span cleanup) are buffered
 * and only executed after the caller's transaction commits.
 */
export type TransactionHooks = {
  /** Register a hook with the given key. */
  set<T>(key: symbol, hook: HookDefinition<T>): void;
  /** Get the hook state for the given key, creating it with `factory` if absent. */
  getOrInsert<T>(key: symbol, factory: () => HookDefinition<T>): T;
  /** Get the hook state for the given key. Throws {@link HookNotRegisteredError} if not found. */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- intentional: caller specifies T for type-safe cast
  get<T>(key: symbol): T;
  /** Check whether a hook is registered for the given key. */
  has(key: symbol): boolean;
  /** Remove the hook for the given key. */
  delete(key: symbol): void;
  /** Run `fn` inside a savepoint. Auto-rollback on error, auto-release on success. */
  withSavepoint<T>(fn: (transactionHooks: TransactionHooks) => T | Promise<T>): Promise<T>;
  /** Create a manual savepoint. Call `rollback()` to restore or `release()` to keep changes. */
  createSavepoint(): TransactionHooksSavepoint;
};

/** A savepoint handle with manual rollback/release control. */
export type TransactionHooksSavepoint = {
  transactionHooks: TransactionHooks;
  rollback(): void;
  release(): void;
};

/**
 * A {@link TransactionHooks} instance with `flush` and `discard` lifecycle methods.
 *
 * - Call `flush()` after the transaction commits to execute all buffered side effects.
 * - Call `discard()` on rollback to clean up without executing side effects.
 */
export type TransactionHooksHandle = {
  transactionHooks: TransactionHooks;
  flush: () => Promise<void>;
  discard: () => Promise<void>;
};

/**
 * Create a new transaction hooks handle.
 *
 * Returns `transactionHooks` (pass to mutating client methods), `flush` (call after commit),
 * and `discard` (call on rollback).
 */
export const createTransactionHooks = (): TransactionHooksHandle => {
  const hooks = new Map<symbol, HookDefinition<any>>();

  const captureSnapshot = () => {
    const entries = new Map<
      symbol,
      { hookDefinition: HookDefinition<any>; rollback?: () => void }
    >();
    for (const [key, hookDefinition] of hooks) {
      entries.set(key, {
        hookDefinition,
        rollback: hookDefinition.checkpoint?.(hookDefinition.state),
      });
    }
    return { entries };
  };

  type Snapshot = ReturnType<typeof captureSnapshot>;

  const restoreSnapshot = (snapshot: Snapshot) => {
    const removedKeys: symbol[] = [];
    for (const [key, hookDefinition] of hooks) {
      if (!snapshot.entries.has(key)) {
        try {
          const result = hookDefinition.discard?.(hookDefinition.state);
          if (result && typeof result.catch === "function") {
            result.catch(() => {});
          }
        } catch {}
        removedKeys.push(key);
      }
    }
    for (const key of removedKeys) {
      hooks.delete(key);
    }
    for (const [key, entry] of snapshot.entries) {
      if (!hooks.has(key)) {
        hooks.set(key, entry.hookDefinition);
      }
      entry.rollback?.();
    }
  };

  const transactionHooks: TransactionHooks = {
    set: <T>(key: symbol, hook: HookDefinition<T>): void => {
      hooks.set(key, hook);
    },
    getOrInsert: <T>(key: symbol, factory: () => HookDefinition<T>): T => {
      if (!hooks.has(key)) {
        hooks.set(key, factory());
      }
      return hooks.get(key)!.state as T;
    },
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- intentional: caller specifies T for type-safe cast
    get: <T>(key: symbol): T => {
      const hook = hooks.get(key);
      if (!hook) {
        throw new HookNotRegisteredError(`TransactionHooks hook not registered: ${String(key)}`, {
          key,
        });
      }
      return hook.state as T;
    },
    has: (key: symbol): boolean => hooks.has(key),
    delete: (key: symbol): void => {
      hooks.delete(key);
    },
    createSavepoint: (): TransactionHooksSavepoint => {
      const snapshot = captureSnapshot();
      return {
        transactionHooks,
        rollback: () => {
          restoreSnapshot(snapshot);
        },
        release: () => {
          // no-op: keep current state
        },
      };
    },
    withSavepoint: async <T>(
      fn: (transactionHooks: TransactionHooks) => T | Promise<T>,
    ): Promise<T> => {
      const sp = transactionHooks.createSavepoint();
      try {
        const result = await fn(transactionHooks);
        sp.release();
        return result;
      } catch (error) {
        sp.rollback();
        throw error;
      }
    },
  };

  const flush = async (): Promise<void> => {
    const snapshot = [...hooks.values()];
    hooks.clear();

    let firstError: unknown;
    for (const hook of snapshot) {
      try {
        await hook.flush(hook.state);
      } catch (error) {
        firstError ??= error;
      }
    }
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (firstError) throw firstError;
  };

  const discard = async (): Promise<void> => {
    const snapshot = [...hooks.values()];
    hooks.clear();

    let firstError: unknown;
    for (const hook of snapshot) {
      try {
        await hook.discard?.(hook.state);
      } catch (error) {
        firstError ??= error;
      }
    }
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (firstError) throw firstError;
  };

  return { transactionHooks, flush, discard };
};

/** Execute a callback with auto-managed transaction hooks. Flushes on success, discards on error. */
export const withTransactionHooks = async <T>(
  cb: (transactionHooks: TransactionHooks) => Promise<T>,
): Promise<T> => {
  const { transactionHooks, flush, discard } = createTransactionHooks();
  try {
    const result = await cb(transactionHooks);
    await flush();
    return result;
  } catch (error) {
    await discard().catch(() => {});
    throw error;
  }
};
