import { describe, expect, test, vi } from "vitest";
import { createTransactionHooks, withTransactionHooks } from "./transaction-hooks.js";
import { HookNotRegisteredError } from "./errors.js";

describe("TransactionHooks", () => {
  test("getOrInsert: lazily registers hook and returns state", async () => {
    const key = Symbol("test");
    const flush = vi.fn();

    await withTransactionHooks(async (hooks) => {
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

    await withTransactionHooks(async (hooks) => {
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

    await withTransactionHooks(async (hooks) => {
      expect(() => hooks.get(key)).toThrow(HookNotRegisteredError);
      expect(() => hooks.get(key)).toThrow("TransactionHooks hook not registered");
    });
  });

  test("has: checks existence", async () => {
    const key = Symbol("test");

    await withTransactionHooks(async (hooks) => {
      expect(hooks.has(key)).toBe(false);
      hooks.set(key, { state: null, flush: () => {} });
      expect(hooks.has(key)).toBe(true);
    });
  });

  test("delete: deletes hook so it is not flushed", async () => {
    const key = Symbol("test");
    const flush = vi.fn();

    await withTransactionHooks(async (hooks) => {
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

    await withTransactionHooks(async (hooks) => {
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

    await withTransactionHooks(async (hooks) => {
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

    await withTransactionHooks(async (hooks) => {
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

  test("flush: runs all hooks even if one throws, then rethrows first error", async () => {
    const flush2 = vi.fn();
    const key1 = Symbol("first");
    const key2 = Symbol("second");
    const error = new Error("flush failed");

    await expect(
      withTransactionHooks(async (hooks) => {
        hooks.set(key1, {
          state: null,
          flush: () => {
            throw error;
          },
        });
        hooks.set(key2, { state: null, flush: flush2 });
      }),
    ).rejects.toThrow(error);

    expect(flush2).toHaveBeenCalledOnce();
  });

  test("multiple getOrInsert calls with different keys", async () => {
    const key1 = Symbol("a");
    const key2 = Symbol("b");
    const flush1 = vi.fn();
    const flush2 = vi.fn();

    await withTransactionHooks(async (hooks) => {
      const s1 = hooks.getOrInsert(key1, () => ({ state: [1], flush: flush1 }));
      const s2 = hooks.getOrInsert(key2, () => ({ state: [2], flush: flush2 }));
      s1.push(10);
      s2.push(20);
    });

    expect(flush1).toHaveBeenCalledWith([1, 10]);
    expect(flush2).toHaveBeenCalledWith([2, 20]);
  });
});

describe("withTransactionHooks", () => {
  test("returns callback result on success", async () => {
    const result = await withTransactionHooks(async () => 42);
    expect(result).toBe(42);
  });

  test("propagates callback error", async () => {
    const error = new Error("boom");
    await expect(
      withTransactionHooks(async () => {
        throw error;
      }),
    ).rejects.toThrow(error);
  });

  test("discards hooks when callback throws", async () => {
    const flush = vi.fn();
    const key = Symbol("test");

    await expect(
      withTransactionHooks(async (hooks) => {
        hooks.set(key, { state: "data", flush });
        throw new Error("transaction failed");
      }),
    ).rejects.toThrow("transaction failed");

    expect(flush).not.toHaveBeenCalled();
  });

  test("calls hook discard functions when callback throws", async () => {
    const flush = vi.fn();
    const discard = vi.fn();
    const key = Symbol("test");

    await expect(
      withTransactionHooks(async (hooks) => {
        hooks.set(key, { state: "data", flush, discard });
        throw new Error("transaction failed");
      }),
    ).rejects.toThrow("transaction failed");

    expect(flush).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledWith("data");
  });

  test("calls async hook discard functions when callback throws", async () => {
    const order: string[] = [];
    const key1 = Symbol("first");
    const key2 = Symbol("second");

    await expect(
      withTransactionHooks(async (hooks) => {
        hooks.set(key1, {
          state: "a",
          flush: () => {},
          discard: async (state) => {
            await new Promise((r) => setTimeout(r, 10));
            order.push(`discard-${state}`);
          },
        });
        hooks.set(key2, {
          state: "b",
          flush: () => {},
          discard: async (state) => {
            order.push(`discard-${state}`);
          },
        });
        throw new Error("transaction failed");
      }),
    ).rejects.toThrow("transaction failed");

    expect(order).toEqual(["discard-a", "discard-b"]);
  });

  test("discard: runs all hooks even if one throws, then rethrows original error", async () => {
    const discard2 = vi.fn();
    const key1 = Symbol("first");
    const key2 = Symbol("second");
    const txError = new Error("transaction failed");

    await expect(
      withTransactionHooks(async (hooks) => {
        hooks.set(key1, {
          state: null,
          flush: () => {},
          discard: () => {
            throw new Error("discard failed");
          },
        });
        hooks.set(key2, {
          state: null,
          flush: () => {},
          discard: discard2,
        });
        throw txError;
      }),
    ).rejects.toThrow(txError);

    expect(discard2).toHaveBeenCalledOnce();
  });
});

describe("createTransactionHooks", () => {
  test("manual lifecycle - flush on success", async () => {
    const key = Symbol("test");
    const flushFn = vi.fn();

    const { transactionHooks, flush } = createTransactionHooks();
    transactionHooks.set(key, { state: "data", flush: flushFn });

    await flush();

    expect(flushFn).toHaveBeenCalledOnce();
    expect(flushFn).toHaveBeenCalledWith("data");
  });

  test("manual lifecycle - discard on error", async () => {
    const key = Symbol("test");
    const flushFn = vi.fn();

    const { transactionHooks, discard } = createTransactionHooks();
    transactionHooks.set(key, { state: "data", flush: flushFn });

    await discard();

    expect(flushFn).not.toHaveBeenCalled();
    expect(transactionHooks.has(key)).toBe(false);
  });

  test("manual lifecycle - discard calls hook discard functions", async () => {
    const key = Symbol("test");
    const flushFn = vi.fn();
    const discardFn = vi.fn();

    const { transactionHooks, discard } = createTransactionHooks();
    transactionHooks.set(key, { state: "data", flush: flushFn, discard: discardFn });

    await discard();

    expect(flushFn).not.toHaveBeenCalled();
    expect(discardFn).toHaveBeenCalledOnce();
    expect(discardFn).toHaveBeenCalledWith("data");
  });
});
