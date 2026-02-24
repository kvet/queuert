import { HookNotRegisteredError } from "./errors.js";

type HookDef<T> = {
  state: T;
  flush: (state: T) => void | Promise<void>;
  discard?: (state: T) => void | Promise<void>;
};

export type TransactionHooks = {
  set<T>(key: symbol, hook: HookDef<T>): void;
  getOrInsert<T>(key: symbol, factory: () => HookDef<T>): T;
  get<T>(key: symbol): T;
  has(key: symbol): boolean;
  delete(key: symbol): void;
};

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
        throw new HookNotRegisteredError(key);
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
