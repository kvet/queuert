import { describe, expect, test, vi } from "vitest";
import { createCommitHooks, withCommitHooks } from "./commit-hooks.js";
import { HookNotRegisteredError } from "./errors.js";

describe("CommitHooks", () => {
  test("getOrInsert: lazily registers hook and returns state", async () => {
    const key = Symbol("test");
    const flush = vi.fn();

    await withCommitHooks(async (hooks) => {
      const state = hooks.getOrInsert(key, () => ({
        state: [] as string[],
        flush,
      }));
      state.push("a");

      const same = hooks.getOrInsert<string[]>(key, () => {
        throw new Error("factory should not be called again");
      });
      same.push("b");

      expect(state).toEqual(["a", "b"]);
      expect(same).toBe(state);
    });

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(["a", "b"]);
  });

  test("set: sets hook, get: retrieves state", async () => {
    const key = Symbol("test");

    await withCommitHooks(async (hooks) => {
      hooks.set(key, {
        state: { count: 0 },
        flush: () => {},
      });

      const state = hooks.get<{ count: number }>(key);
      state.count = 42;

      expect(hooks.get<{ count: number }>(key).count).toBe(42);
    });
  });

  test("get: throws HookNotRegisteredError for missing key", async () => {
    const key = Symbol("missing");

    await withCommitHooks(async (hooks) => {
      expect(() => hooks.get(key)).toThrow(HookNotRegisteredError);
      expect(() => hooks.get(key)).toThrow("CommitHooks hook not registered");
    });
  });

  test("has: checks existence", async () => {
    const key = Symbol("test");

    await withCommitHooks(async (hooks) => {
      expect(hooks.has(key)).toBe(false);
      hooks.set(key, { state: null, flush: () => {} });
      expect(hooks.has(key)).toBe(true);
    });
  });

  test("delete: deletes hook so it is not flushed", async () => {
    const key = Symbol("test");
    const flush = vi.fn();

    await withCommitHooks(async (hooks) => {
      hooks.set(key, { state: "data", flush });
      expect(hooks.has(key)).toBe(true);

      hooks.delete(key);
      expect(hooks.has(key)).toBe(false);
    });

    expect(flush).not.toHaveBeenCalled();
  });

  test("flush: calls all hooks in registration order on success", async () => {
    const order: string[] = [];
    const key1 = Symbol("first");
    const key2 = Symbol("second");

    await withCommitHooks(async (hooks) => {
      hooks.set(key1, {
        state: null,
        flush: () => {
          order.push("first");
        },
      });
      hooks.set(key2, {
        state: null,
        flush: () => {
          order.push("second");
        },
      });
    });

    expect(order).toEqual(["first", "second"]);
  });

  test("flush: passes accumulated state to flush function", async () => {
    const key = Symbol("counter");
    const flush = vi.fn();

    await withCommitHooks(async (hooks) => {
      hooks.set(key, { state: new Set<string>(), flush });
      hooks.get<Set<string>>(key).add("a");
      hooks.get<Set<string>>(key).add("b");
    });

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(new Set(["a", "b"]));
  });

  test("flush: supports async flush functions", async () => {
    const order: string[] = [];
    const key1 = Symbol("async1");
    const key2 = Symbol("async2");

    await withCommitHooks(async (hooks) => {
      hooks.set(key1, {
        state: null,
        flush: async () => {
          await new Promise((r) => setTimeout(r, 10));
          order.push("first");
        },
      });
      hooks.set(key2, {
        state: null,
        flush: async () => {
          order.push("second");
        },
      });
    });

    // Sequential flush: first completes before second starts
    expect(order).toEqual(["first", "second"]);
  });

  test("multiple getOrInsert calls with different keys", async () => {
    const key1 = Symbol("a");
    const key2 = Symbol("b");
    const flush1 = vi.fn();
    const flush2 = vi.fn();

    await withCommitHooks(async (hooks) => {
      const s1 = hooks.getOrInsert(key1, () => ({ state: [1], flush: flush1 }));
      const s2 = hooks.getOrInsert(key2, () => ({ state: [2], flush: flush2 }));
      s1.push(10);
      s2.push(20);
    });

    expect(flush1).toHaveBeenCalledWith([1, 10]);
    expect(flush2).toHaveBeenCalledWith([2, 20]);
  });
});

describe("withCommitHooks", () => {
  test("returns callback result on success", async () => {
    const result = await withCommitHooks(async () => 42);
    expect(result).toBe(42);
  });

  test("propagates callback error", async () => {
    const error = new Error("boom");
    await expect(
      withCommitHooks(async () => {
        throw error;
      }),
    ).rejects.toThrow(error);
  });

  test("discards hooks when callback throws", async () => {
    const flush = vi.fn();
    const key = Symbol("test");

    await expect(
      withCommitHooks(async (hooks) => {
        hooks.set(key, { state: "data", flush });
        throw new Error("transaction failed");
      }),
    ).rejects.toThrow("transaction failed");

    expect(flush).not.toHaveBeenCalled();
  });
});

describe("createCommitHooks", () => {
  test("manual lifecycle - flush on success", async () => {
    const key = Symbol("test");
    const flushFn = vi.fn();

    const { commitHooks, flush } = createCommitHooks();
    commitHooks.set(key, { state: "data", flush: flushFn });

    await flush();

    expect(flushFn).toHaveBeenCalledOnce();
    expect(flushFn).toHaveBeenCalledWith("data");
  });

  test("manual lifecycle - discard on error", async () => {
    const key = Symbol("test");
    const flushFn = vi.fn();

    const { commitHooks, discard } = createCommitHooks();
    commitHooks.set(key, { state: "data", flush: flushFn });

    discard();

    expect(flushFn).not.toHaveBeenCalled();
    expect(commitHooks.has(key)).toBe(false);
  });
});
