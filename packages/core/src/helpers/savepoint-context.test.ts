import { describe, expect, test } from "vitest";
import { type TransactionHooks, createTransactionHooks } from "../transaction-hooks.js";
import { createSavepointContext } from "./savepoint-context.js";
import { sleep } from "./sleep.js";

const mockParentRun =
  <TTxCtx>(txCtx: TTxCtx, transactionHooks: TransactionHooks) =>
  async (callback: (txCtx: TTxCtx, transactionHooks: TransactionHooks) => Promise<void>) => {
    await callback(txCtx, transactionHooks);
  };

const mockWithSavepoint = async <TTxCtx>(txCtx: TTxCtx, fn: (txCtx: TTxCtx) => Promise<void>) => {
  await fn(txCtx);
};

describe("createSavepointContext", () => {
  test("resolve lifecycle: passes txCtx, returns values, drains work, releases savepoint", async () => {
    const mockTxCtx = { connection: "sp-conn" };
    const { transactionHooks } = createTransactionHooks();
    let savepointReleased = false;

    const withSavepoint = async (_txCtx: unknown, fn: (ctx: typeof mockTxCtx) => Promise<void>) => {
      await fn(mockTxCtx);
      savepointReleased = true;
    };

    const ctx = await createSavepointContext(mockParentRun({}, transactionHooks), withSavepoint);
    expect(ctx.status).toBe("pending");
    expect(savepointReleased).toBe(false);

    const received = await ctx.run(async (txCtx) => txCtx);
    expect(received).toBe(mockTxCtx);

    const res = await ctx.run(async () => 42);
    expect(res).toBe(42);

    let drained = false;
    const p = ctx.run(async () => {
      await sleep(10);
      drained = true;
    });

    await ctx.resolve();
    await p;

    expect(drained).toBe(true);
    expect(savepointReleased).toBe(true);
    expect(ctx.status).toBe("resolved");
  });

  test("executes callbacks sequentially", async () => {
    const { transactionHooks } = createTransactionHooks();
    const ctx = await createSavepointContext(
      mockParentRun({}, transactionHooks),
      mockWithSavepoint,
    );
    const order: number[] = [];

    const p1 = ctx.run(async () => {
      await sleep(10);
      order.push(1);
    });
    const p2 = ctx.run(async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);

    await ctx.resolve();
  });

  test("reject lifecycle: rolls back savepoint", async () => {
    const { transactionHooks } = createTransactionHooks();
    let savepointError: unknown;

    const withSavepoint = async (_txCtx: unknown, fn: (txCtx: unknown) => Promise<void>) => {
      try {
        await fn(undefined);
      } catch (err) {
        savepointError = err;
        throw err;
      }
    };

    const ctx = await createSavepointContext(mockParentRun({}, transactionHooks), withSavepoint);

    await expect(
      ctx.run(async () => {
        throw new Error("callback error");
      }),
    ).rejects.toThrow("callback error");

    expect(ctx.status).toBe("pending");

    await ctx.reject(new Error("rollback"));
    expect(ctx.status).toBe("rejected");
    expect(savepointError).toEqual(new Error("rollback"));
  });

  test("propagates setup failure instead of hanging", async () => {
    const failingParentRun = async () => {
      throw new Error("connection lost");
    };

    await expect(createSavepointContext(failingParentRun, mockWithSavepoint)).rejects.toThrow(
      "connection lost",
    );
  });

  test("propagates withSavepoint setup failure", async () => {
    const { transactionHooks } = createTransactionHooks();

    const failingWithSavepoint = async () => {
      throw new Error("savepoint failed");
    };

    await expect(
      createSavepointContext(mockParentRun({}, transactionHooks), failingWithSavepoint),
    ).rejects.toThrow("savepoint failed");
  });

  test("terminal state: idempotent resolve/reject, run rejects after close", async () => {
    const { transactionHooks } = createTransactionHooks();

    const resolved = await createSavepointContext(
      mockParentRun({}, transactionHooks),
      mockWithSavepoint,
    );
    await resolved.resolve();
    await resolved.resolve();
    expect(resolved.status).toBe("resolved");
    await expect(resolved.run(async () => 1)).rejects.toThrow("Savepoint is already resolved");

    const { transactionHooks: hooks2 } = createTransactionHooks();
    const rejected = await createSavepointContext(mockParentRun({}, hooks2), mockWithSavepoint);
    await rejected.reject(new Error("rollback"));
    await rejected.reject(new Error("second"));
    expect(rejected.status).toBe("rejected");
    await expect(rejected.run(async () => 1)).rejects.toThrow("Savepoint is already rejected");
  });

  test("resolve releases hooks savepoint (keeps buffered events)", async () => {
    const { transactionHooks, flush } = createTransactionHooks();
    const flushed: string[] = [];
    const hookKey = Symbol("test");

    const ctx = await createSavepointContext(
      mockParentRun({}, transactionHooks),
      mockWithSavepoint,
    );

    await ctx.run(async (_txCtx, hooks) => {
      hooks.getOrInsert(hookKey, () => ({
        state: ["event-a"],
        flush: (state) => {
          flushed.push(...state);
        },
        checkpoint: (s) => {
          const snapshot = [...s];
          return () => {
            s.length = 0;
            s.push(...snapshot);
          };
        },
      }));
    });

    await ctx.resolve();

    expect(transactionHooks.has(hookKey)).toBe(true);
    await flush();
    expect(flushed).toEqual(["event-a"]);
  });

  test("reject rolls back hooks savepoint (discards buffered events)", async () => {
    const { transactionHooks, flush } = createTransactionHooks();
    const flushed: string[] = [];
    const hookKey = Symbol("test");

    const ctx = await createSavepointContext(
      mockParentRun({}, transactionHooks),
      mockWithSavepoint,
    );

    await ctx.run(async (_txCtx, hooks) => {
      hooks.getOrInsert(hookKey, () => ({
        state: ["event-a"],
        flush: (state) => {
          flushed.push(...state);
        },
        checkpoint: (s) => {
          const snapshot = [...s];
          return () => {
            s.length = 0;
            s.push(...snapshot);
          };
        },
      }));
    });

    await ctx.reject(new Error("rollback"));

    expect(transactionHooks.has(hookKey)).toBe(false);
    await flush();
    expect(flushed).toEqual([]);
  });

  test("reject restores hooks to pre-savepoint state", async () => {
    const { transactionHooks, flush } = createTransactionHooks();
    const flushed: string[] = [];
    const hookKey = Symbol("test");

    transactionHooks.getOrInsert(hookKey, () => ({
      state: ["before-savepoint"],
      flush: (state) => {
        flushed.push(...state);
      },
      checkpoint: (s) => {
        const snapshot = [...s];
        return () => {
          s.length = 0;
          s.push(...snapshot);
        };
      },
    }));

    const ctx = await createSavepointContext(
      mockParentRun({}, transactionHooks),
      mockWithSavepoint,
    );

    await ctx.run(async (_txCtx, hooks) => {
      hooks.get<string[]>(hookKey).push("inside-savepoint");
    });

    await ctx.reject(new Error("rollback"));

    await flush();
    expect(flushed).toEqual(["before-savepoint"]);
  });

  test("hooks state survives run error but rolls back on reject", async () => {
    const { transactionHooks, flush } = createTransactionHooks();
    const flushed: string[] = [];
    const hookKey = Symbol("test");

    const ctx = await createSavepointContext(
      mockParentRun({}, transactionHooks),
      mockWithSavepoint,
    );

    await ctx.run(async (_txCtx, hooks) => {
      hooks.getOrInsert(hookKey, () => ({
        state: ["event-1"],
        flush: (state) => {
          flushed.push(...state);
        },
        checkpoint: (s) => {
          const snapshot = [...s];
          return () => {
            s.length = 0;
            s.push(...snapshot);
          };
        },
      }));
    });

    await expect(
      ctx.run(async (_txCtx, hooks) => {
        hooks.get<string[]>(hookKey).push("event-2");
        throw new Error("oops");
      }),
    ).rejects.toThrow("oops");

    // hooks state still has both events (run error doesn't roll back hooks)
    expect(transactionHooks.get<string[]>(hookKey)).toEqual(["event-1", "event-2"]);

    // but reject rolls back hooks to pre-savepoint
    await ctx.reject(new Error("final rollback"));
    expect(transactionHooks.has(hookKey)).toBe(false);

    await flush();
    expect(flushed).toEqual([]);
  });
});
