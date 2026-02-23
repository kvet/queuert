import { HookNotRegisteredError } from "./errors.js";

type HookDef<T> = { state: T; flush: (state: T) => void | Promise<void> };

export type CommitHooks = {
  set<T>(key: symbol, hook: HookDef<T>): void;
  getOrInsert<T>(key: symbol, factory: () => HookDef<T>): T;
  get<T>(key: symbol): T;
  has(key: symbol): boolean;
  delete(key: symbol): void;
};

export const createCommitHooks = () => {
  const hooks = new Map<symbol, HookDef<any>>();

  const commitHooks: CommitHooks = {
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
    for (const hook of snapshot) {
      await hook.flush(hook.state);
    }
  };

  const discard = (): void => {
    hooks.clear();
  };

  return { commitHooks, flush, discard };
};

export const withCommitHooks = async <T>(
  cb: (commitHooks: CommitHooks) => Promise<T>,
): Promise<T> => {
  const { commitHooks, flush, discard } = createCommitHooks();
  try {
    const result = await cb(commitHooks);
    await flush();
    return result;
  } catch (error) {
    discard();
    throw error;
  }
};
