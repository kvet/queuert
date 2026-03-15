import { describe, expect, test, vi } from "vitest";
import { HookNotRegisteredError } from "./errors.js";
import {
  bufferObservabilityEvent as bufferOnCommit,
  bufferObservabilityRollback as bufferOnRollback,
} from "./helpers/observability-hooks.js";
import { createTransactionHooks, withTransactionHooks } from "./transaction-hooks.js";

const arrayHook = (initial: string[] = []) => ({
  state: [...initial],
  flush: () => {},
  checkpoint: (s: string[]) => {
    const snapshot = [...s];
    return () => {
      s.length = 0;
      s.push(...snapshot);
    };
  },
});

const setHook = (initial: string[] = []) => ({
  state: new Set(initial),
  flush: () => {},
  checkpoint: (s: Set<string>) => {
    const snapshot = new Set(s);
    return () => {
      s.clear();
      for (const v of snapshot) s.add(v);
    };
  },
});

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
      hooks.set(key, {
        state: new Set<string>(),
        flush,
      });
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
      const s1 = hooks.getOrInsert(key1, () => ({
        state: [1],
        flush: flush1,
      }));
      const s2 = hooks.getOrInsert(key2, () => ({
        state: [2],
        flush: flush2,
      }));
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
    transactionHooks.set(key, {
      state: "data",
      flush: flushFn,
      discard: discardFn,
    });

    await discard();

    expect(flushFn).not.toHaveBeenCalled();
    expect(discardFn).toHaveBeenCalledOnce();
    expect(discardFn).toHaveBeenCalledWith("data");
  });
});

describe("withSavepoint", () => {
  test("returns fn result on success and keeps hooks", async () => {
    const key = Symbol("test");

    await withTransactionHooks(async (hooks) => {
      hooks.set(key, arrayHook());

      const result = await hooks.withSavepoint(async (hooks) => {
        hooks.get<string[]>(key).push("a");
        return 42;
      });

      expect(result).toBe(42);
      expect(hooks.get<string[]>(key)).toEqual(["a"]);
    });
  });

  test("rolls back hooks added during fn when fn throws", async () => {
    const key1 = Symbol("existing");
    const key2 = Symbol("added-in-savepoint");

    await withTransactionHooks(async (hooks) => {
      hooks.set(key1, arrayHook(["before"]));

      await expect(
        hooks.withSavepoint(async (hooks) => {
          hooks.set(key2, arrayHook(["new"]));
          expect(hooks.has(key2)).toBe(true);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(hooks.has(key1)).toBe(true);
      expect(hooks.has(key2)).toBe(false);
    });
  });

  test("restores checkpointed state of pre-existing hooks on rollback", async () => {
    const key = Symbol("test");

    await withTransactionHooks(async (hooks) => {
      hooks.set(key, arrayHook(["a", "b"]));

      await expect(
        hooks.withSavepoint(async (hooks) => {
          hooks.get<string[]>(key).push("c");
          expect(hooks.get<string[]>(key)).toEqual(["a", "b", "c"]);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(hooks.get<string[]>(key)).toEqual(["a", "b"]);
    });
  });

  test("passes the same transactionHooks instance to the callback", async () => {
    await withTransactionHooks(async (hooks) => {
      await hooks.withSavepoint(async (inner) => {
        expect(inner).toBe(hooks);
      });
    });
  });

  test("nested savepoints: inner rollback does not affect outer state", async () => {
    const key = Symbol("test");

    await withTransactionHooks(async (hooks) => {
      hooks.set(key, arrayHook(["a"]));

      await hooks.withSavepoint(async (hooks) => {
        hooks.get<string[]>(key).push("b");

        await expect(
          hooks.withSavepoint(async (hooks) => {
            hooks.get<string[]>(key).push("c");
            expect(hooks.get<string[]>(key)).toEqual(["a", "b", "c"]);
            throw new Error("inner");
          }),
        ).rejects.toThrow("inner");

        expect(hooks.get<string[]>(key)).toEqual(["a", "b"]);
      });

      expect(hooks.get<string[]>(key)).toEqual(["a", "b"]);
    });
  });

  test("nested savepoints: outer rollback also rolls back inner changes", async () => {
    const key = Symbol("test");

    await withTransactionHooks(async (hooks) => {
      hooks.set(key, arrayHook(["a"]));

      await expect(
        hooks.withSavepoint(async (hooks) => {
          hooks.get<string[]>(key).push("b");

          await hooks.withSavepoint(async (hooks) => {
            hooks.get<string[]>(key).push("c");
          });

          expect(hooks.get<string[]>(key)).toEqual(["a", "b", "c"]);
          throw new Error("outer");
        }),
      ).rejects.toThrow("outer");

      expect(hooks.get<string[]>(key)).toEqual(["a"]);
    });
  });

  test("works with Set-based hooks", async () => {
    const key = Symbol("set");

    await withTransactionHooks(async (hooks) => {
      hooks.set(key, setHook(["x"]));

      await expect(
        hooks.withSavepoint(async (hooks) => {
          hooks.get<Set<string>>(key).add("y");
          expect(hooks.get<Set<string>>(key)).toEqual(new Set(["x", "y"]));
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(hooks.get<Set<string>>(key)).toEqual(new Set(["x"]));
    });
  });

  test("rollback on empty hooks removes hooks added inside fn", async () => {
    const key = Symbol("added");

    await withTransactionHooks(async (hooks) => {
      await expect(
        hooks.withSavepoint(async (hooks) => {
          hooks.set(key, arrayHook(["x"]));
          expect(hooks.has(key)).toBe(true);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(hooks.has(key)).toBe(false);
    });
  });

  test("flush receives accumulated state, not checkpointed", async () => {
    const key = Symbol("test");
    const flush = vi.fn();

    await withTransactionHooks(async (hooks) => {
      hooks.set(key, { ...arrayHook(), flush });

      await hooks.withSavepoint(async (hooks) => {
        hooks.get<string[]>(key).push("a");
      });

      hooks.get<string[]>(key).push("b");
    });

    expect(flush).toHaveBeenCalledWith(["a", "b"]);
  });
});

describe("createSavepoint", () => {
  test("rollback removes hooks added after savepoint", async () => {
    const { transactionHooks } = createTransactionHooks();
    const key1 = Symbol("before");
    const key2 = Symbol("after");

    transactionHooks.set(key1, arrayHook());
    const sp = transactionHooks.createSavepoint();

    transactionHooks.set(key2, arrayHook());
    expect(transactionHooks.has(key2)).toBe(true);

    sp.rollback();

    expect(transactionHooks.has(key1)).toBe(true);
    expect(transactionHooks.has(key2)).toBe(false);
  });

  test("rollback restores checkpointed state of existing hooks", async () => {
    const { transactionHooks } = createTransactionHooks();
    const key = Symbol("test");

    transactionHooks.set(key, arrayHook(["a"]));
    const sp = transactionHooks.createSavepoint();

    transactionHooks.get<string[]>(key).push("b");
    expect(transactionHooks.get<string[]>(key)).toEqual(["a", "b"]);

    sp.rollback();

    expect(transactionHooks.get<string[]>(key)).toEqual(["a"]);
  });

  test("release keeps current state", async () => {
    const { transactionHooks } = createTransactionHooks();
    const key = Symbol("test");

    transactionHooks.set(key, arrayHook(["a"]));
    const sp = transactionHooks.createSavepoint();

    transactionHooks.get<string[]>(key).push("b");

    sp.release();

    expect(transactionHooks.get<string[]>(key)).toEqual(["a", "b"]);
  });

  test("returns the same transactionHooks instance", () => {
    const { transactionHooks } = createTransactionHooks();
    const sp = transactionHooks.createSavepoint();
    expect(sp.transactionHooks).toBe(transactionHooks);
  });

  test("selective rollback: error in one operation, rollback, then continue", async () => {
    const handle = createTransactionHooks();
    const key = Symbol("events");
    const flushFn = vi.fn();

    handle.transactionHooks.set(key, { ...arrayHook(), flush: flushFn });

    handle.transactionHooks.get<string[]>(key).push("event-1");

    const sp = handle.transactionHooks.createSavepoint();
    handle.transactionHooks.get<string[]>(key).push("event-2-bad");
    sp.rollback();

    handle.transactionHooks.get<string[]>(key).push("event-3");

    await handle.flush();

    expect(flushFn).toHaveBeenCalledWith(["event-1", "event-3"]);
  });

  test("rollback restores hooks deleted after savepoint", async () => {
    const { transactionHooks } = createTransactionHooks();
    const key = Symbol("test");

    transactionHooks.set(key, arrayHook(["a"]));
    const sp = transactionHooks.createSavepoint();

    transactionHooks.delete(key);
    expect(transactionHooks.has(key)).toBe(false);

    sp.rollback();

    expect(transactionHooks.has(key)).toBe(true);
    expect(transactionHooks.get<string[]>(key)).toEqual(["a"]);
  });

  test("double rollback is a no-op on second call", () => {
    const { transactionHooks } = createTransactionHooks();
    const key = Symbol("test");

    transactionHooks.set(key, arrayHook(["a"]));
    const sp = transactionHooks.createSavepoint();

    transactionHooks.get<string[]>(key).push("b");
    sp.rollback();
    expect(transactionHooks.get<string[]>(key)).toEqual(["a"]);

    transactionHooks.get<string[]>(key).push("c");
    sp.rollback();
    expect(transactionHooks.get<string[]>(key)).toEqual(["a"]);
  });

  test("rollback after release still restores", () => {
    const { transactionHooks } = createTransactionHooks();
    const key = Symbol("test");

    transactionHooks.set(key, arrayHook(["a"]));
    const sp = transactionHooks.createSavepoint();

    transactionHooks.get<string[]>(key).push("b");
    sp.release();
    expect(transactionHooks.get<string[]>(key)).toEqual(["a", "b"]);

    transactionHooks.get<string[]>(key).push("c");
    sp.rollback();
    expect(transactionHooks.get<string[]>(key)).toEqual(["a"]);
  });

  test("savepoint on empty hooks removes hooks added after", () => {
    const { transactionHooks } = createTransactionHooks();
    const key = Symbol("test");

    const sp = transactionHooks.createSavepoint();

    transactionHooks.set(key, arrayHook(["a"]));
    expect(transactionHooks.has(key)).toBe(true);

    sp.rollback();

    expect(transactionHooks.has(key)).toBe(false);
  });

  test("checkpoint is called eagerly during createSavepoint", () => {
    const { transactionHooks } = createTransactionHooks();
    const key = Symbol("test");
    const checkpoint = vi.fn((s: string[]) => {
      const snapshot = [...s];
      return () => {
        s.length = 0;
        s.push(...snapshot);
      };
    });

    transactionHooks.set(key, { state: ["a"], flush: () => {}, checkpoint });

    expect(checkpoint).not.toHaveBeenCalled();

    transactionHooks.createSavepoint();

    expect(checkpoint).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenCalledWith(["a"]);
  });
});

describe("bufferOnCommit / bufferOnRollback", () => {
  test("bufferOnCommit callbacks run on flush", async () => {
    const order: string[] = [];
    const { transactionHooks, flush } = createTransactionHooks();

    bufferOnCommit(transactionHooks, () => void order.push("a"));
    bufferOnCommit(transactionHooks, () => void order.push("b"));

    await flush();

    expect(order).toEqual(["a", "b"]);
  });

  test("bufferOnCommit callbacks do not run on discard", async () => {
    const cb = vi.fn();
    const { transactionHooks, discard } = createTransactionHooks();

    bufferOnCommit(transactionHooks, cb);

    await discard();

    expect(cb).not.toHaveBeenCalled();
  });

  test("bufferOnRollback callbacks run on discard", async () => {
    const order: string[] = [];
    const { transactionHooks, discard } = createTransactionHooks();

    bufferOnRollback(transactionHooks, () => void order.push("a"));
    bufferOnRollback(transactionHooks, () => void order.push("b"));

    await discard();

    expect(order).toEqual(["a", "b"]);
  });

  test("bufferOnRollback callbacks do not run on flush", async () => {
    const cb = vi.fn();
    const { transactionHooks, flush } = createTransactionHooks();

    bufferOnRollback(transactionHooks, cb);

    await flush();

    expect(cb).not.toHaveBeenCalled();
  });

  test("savepoint rollback discards bufferOnCommit callbacks from scope", async () => {
    const order: string[] = [];
    const { transactionHooks, flush } = createTransactionHooks();

    bufferOnCommit(transactionHooks, () => void order.push("before"));

    const sp = transactionHooks.createSavepoint();
    bufferOnCommit(transactionHooks, () => void order.push("inside"));
    sp.rollback();

    bufferOnCommit(transactionHooks, () => void order.push("after"));

    await flush();

    expect(order).toEqual(["before", "after"]);
  });

  test("savepoint rollback runs bufferOnRollback callbacks from scope", () => {
    const order: string[] = [];
    const { transactionHooks } = createTransactionHooks();

    bufferOnRollback(transactionHooks, () => void order.push("before"));

    const sp = transactionHooks.createSavepoint();
    bufferOnRollback(transactionHooks, () => void order.push("inside"));
    sp.rollback();

    expect(order).toEqual(["inside"]);
  });

  test("savepoint release promotes bufferOnRollback callbacks to parent scope", async () => {
    const order: string[] = [];
    const { transactionHooks, discard } = createTransactionHooks();

    const sp = transactionHooks.createSavepoint();
    bufferOnRollback(transactionHooks, () => void order.push("promoted"));
    sp.release();

    await discard();

    expect(order).toEqual(["promoted"]);
  });

  test("nested savepoints: inner rollback runs inner, outer rollback runs outer", () => {
    const order: string[] = [];
    const { transactionHooks } = createTransactionHooks();

    const outer = transactionHooks.createSavepoint();
    bufferOnRollback(transactionHooks, () => void order.push("outer"));

    const inner = transactionHooks.createSavepoint();
    bufferOnRollback(transactionHooks, () => void order.push("inner"));
    inner.rollback();

    expect(order).toEqual(["inner"]);

    outer.rollback();

    expect(order).toEqual(["inner", "outer"]);
  });

  test("bufferOnCommit works alongside getOrInsert hooks", async () => {
    const order: string[] = [];
    const key = Symbol("test");
    const { transactionHooks, flush } = createTransactionHooks();

    transactionHooks.getOrInsert(key, () => ({
      state: ["hook-state"],
      flush: (state) => void order.push(`hook:${state[0]}`),
    }));
    bufferOnCommit(transactionHooks, () => void order.push("commit-cb"));

    await flush();

    expect(order).toEqual(["hook:hook-state", "commit-cb"]);
  });

  test("withTransactionHooks runs bufferOnRollback on error", async () => {
    const cb = vi.fn();

    await expect(
      withTransactionHooks(async (hooks) => {
        bufferOnRollback(hooks, cb);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(cb).toHaveBeenCalledOnce();
  });

  test("savepoint rollback runs bufferOnRollback even if callback throws", () => {
    const secondCb = vi.fn();
    const { transactionHooks } = createTransactionHooks();

    const sp = transactionHooks.createSavepoint();
    bufferOnRollback(transactionHooks, () => {
      throw new Error("rollback error");
    });
    bufferOnRollback(transactionHooks, secondCb);
    sp.rollback();

    expect(secondCb).toHaveBeenCalledOnce();
  });
});
