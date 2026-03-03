import { HookNotRegisteredError } from "./errors.js";

type HookDef<T> = {
  state: T;
  flush: (state: T) => void | Promise<void>;
  discard?: (state: T) => void | Promise<void>;
};

/**
 * A key-value store for transaction-scoped hooks.
 *
 * Side effects (notifications, observability) are buffered via hooks and
 * only flushed after the caller's transaction commits.
 */
export type TransactionHooks = {
  /** Register a hook with the given key. */
  set<T>(key: symbol, hook: HookDef<T>): void;
  /** Get the hook state for the given key, creating it with `factory` if absent. */
  getOrInsert<T>(key: symbol, factory: () => HookDef<T>): T;
  /** Get the hook state for the given key. Throws {@link HookNotRegisteredError} if not found. */
  get<T>(key: symbol): T;
  /** Check whether a hook is registered for the given key. */
  has(key: symbol): boolean;
  /** Remove the hook for the given key. */
  delete(key: symbol): void;
};

/**
 * Create a new transaction hooks handle.
 *
 * Returns `transactionHooks` (pass to mutating client methods), `flush` (call after commit),
 * and `discard` (call on rollback).
 */
export const createTransactionHooks = () => {
  const hooks = new Map<symbol, HookDef<any>>();

  const transactionHooks: TransactionHooks = {
    set: <T>(key: symbol, hook: HookDef<T>): void => {
      hooks.set(key, hook);
    },
    getOrInsert: <T>(key: symbol, factory: () => HookDef<T>): T => {
      if (!hooks.has(key)) {
        hooks.set(key, factory());
      }
      return hooks.get(key)!.state as T;
    },
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
    if (firstError) throw firstError;
  };

  return { transactionHooks, flush, discard };
};

/**
 * A {@link TransactionHooks} instance with `flush` and `discard` lifecycle methods.
 *
 * - Call `flush()` after the transaction commits to execute all buffered side effects.
 * - Call `discard()` on rollback to clean up without executing side effects.
 */
export type TransactionHooksHandle = ReturnType<typeof createTransactionHooks>;

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
