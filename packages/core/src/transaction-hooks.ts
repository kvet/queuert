import { isThenable } from "@queuert/helpers";

import { HookNotRegisteredError } from "./errors.js";

/** Defines a named hook with mutable state, a flush callback for commit, an optional discard callback for rollback, and an optional checkpoint callback for savepoint support. */
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
  /**
   * Run `fn` inside a savepoint. Auto-rollback on error, auto-release on success. Returns `fn`'s
   * result as is: synchronously for a synchronous `fn`, as a promise for an async one.
   */
  withSavepoint<T>(fn: (transactionHooks: TransactionHooks) => T): T;
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
  const { transactionHooks, flush, discard } = createTransactionHooksWithSync();
  return { transactionHooks, flush, discard };
};

const createTransactionHooksWithSync = (): TransactionHooksHandle & {
  flushSync: () => void;
  discardSync: () => void;
} => {
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
    withSavepoint: <T>(fn: (transactionHooks: TransactionHooks) => T): T => {
      const sp = transactionHooks.createSavepoint();
      let result: T;
      try {
        result = fn(transactionHooks);
      } catch (error) {
        sp.rollback();
        throw error;
      }
      if (!isThenable(result)) {
        sp.release();
        return result;
      }
      return Promise.resolve(result).then(
        (value) => {
          sp.release();
          return value;
        },
        (error: unknown) => {
          sp.rollback();
          throw error;
        },
      ) as T;
    },
  };

  const runHooks = (method: "flush" | "discard"): HookOutcome[] => {
    const snapshot = [...hooks.values()];
    hooks.clear();
    return snapshot.map((hook) => {
      try {
        return { result: hook[method]?.(hook.state) };
      } catch (error) {
        return { error };
      }
    });
  };

  return {
    transactionHooks,
    flush: async () => settleHooks(runHooks("flush")),
    discard: async () => settleHooks(runHooks("discard")),
    flushSync: () => {
      settleHooksSync(runHooks("flush"));
    },
    discardSync: () => {
      settleHooksSync(runHooks("discard"));
    },
  };
};

type HookOutcome = { result: unknown } | { error: unknown };

const settleHooks = async (outcomes: HookOutcome[]): Promise<void> => {
  const results = await Promise.allSettled(
    outcomes.map(async (outcome) => {
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
      if ("error" in outcome) throw outcome.error;
      return outcome.result;
    }),
  );
  const firstError = results.find(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  )?.reason;
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
  if (firstError) throw firstError;
};

const settleHooksSync = (outcomes: HookOutcome[]): void => {
  let pending = false;
  for (const outcome of outcomes) {
    if ("result" in outcome && isThenable(outcome.result)) {
      pending = true;
      outcome.result.then(undefined, () => {});
    }
  }
  const failed = outcomes.find((outcome) => "error" in outcome);
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
  if (failed && "error" in failed) throw failed.error;
  if (pending) {
    throw new Error(
      "withTransactionHooks with a synchronous callback requires synchronous hooks: a hook's flush or discard returned a promise",
    );
  }
};

/**
 * Execute a callback with auto-managed transaction hooks. Flushes on success, discards on error.
 * Returns `cb`'s result as is: a promise for an async `cb`, settling once the hooks have flushed
 * after commit, and the value itself for a synchronous `cb`, so a synchronous transaction needs
 * no `await`. A synchronous `cb` requires every registered hook to flush synchronously.
 */
export const withTransactionHooks = <T>(cb: (transactionHooks: TransactionHooks) => T): T => {
  const { transactionHooks, flush, discard, flushSync, discardSync } =
    createTransactionHooksWithSync();
  let result: T;
  try {
    result = cb(transactionHooks);
  } catch (error) {
    try {
      discardSync();
    } catch {}
    throw error;
  }
  if (!isThenable(result)) {
    flushSync();
    return result;
  }
  return Promise.resolve(result).then(
    async (value) => {
      await flush();
      return value;
    },
    async (error: unknown) => {
      await discard().catch(() => {});
      throw error;
    },
  ) as T;
};

export const requireTransactionHooks = (
  transactionHooks: TransactionHooks | undefined,
  caller: string,
): void => {
  if (transactionHooks === undefined) {
    throw new Error(`${caller} requires transactionHooks`);
  }
};
