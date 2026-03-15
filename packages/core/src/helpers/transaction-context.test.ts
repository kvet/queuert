import { describe, expect, test } from "vitest";
import { type TransactionHooks } from "../transaction-hooks.js";
import { sleep } from "./sleep.js";
import { createTransactionContext } from "./transaction-context.js";

const mockRunInTransaction = async (callback: (txCtx: unknown) => Promise<void>) => {
  await callback(undefined);
};

describe("createTransactionContext", () => {
  test("resolve lifecycle: passes txCtx, returns values, drains work, closes transaction", async () => {
    const mockTx = { client: "mock-client", id: 42 };
    let transactionEnded = false;

    const runInTransaction = async (callback: (txCtx: typeof mockTx) => Promise<void>) => {
      await callback(mockTx);
      transactionEnded = true;
    };

    const ctx = await createTransactionContext(runInTransaction);
    expect(ctx.status).toBe("pending");
    expect(transactionEnded).toBe(false);

    const received = await ctx.run(async (txCtx) => txCtx);
    expect(received).toBe(mockTx);

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
    expect(transactionEnded).toBe(true);
    expect(ctx.status).toBe("resolved");
  });

  test("executes callbacks sequentially", async () => {
    const mockRunInTransaction = async (callback: (txCtx: unknown) => Promise<void>) => {
      await callback(undefined);
    };
    const ctx = await createTransactionContext(mockRunInTransaction);
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

  test("reject lifecycle: propagates errors and rolls back", async () => {
    let transactionError: unknown;

    const runInTransaction = async (callback: (txCtx: unknown) => Promise<void>) => {
      try {
        await callback(undefined);
      } catch (err) {
        transactionError = err;
        throw err;
      }
    };

    const ctx = await createTransactionContext(runInTransaction);

    await expect(
      ctx.run(async () => {
        throw new Error("callback error");
      }),
    ).rejects.toThrow("callback error");

    expect(ctx.status).toBe("pending");

    await ctx.reject(new Error("rollback"));
    expect(ctx.status).toBe("rejected");
    expect(transactionError).toEqual(new Error("rollback"));
  });

  test("propagates runInTransaction setup failure instead of hanging", async () => {
    const setupError = new Error("connection reset");

    const runInTransaction = async () => {
      throw setupError;
    };

    await expect(createTransactionContext(runInTransaction)).rejects.toThrow("connection reset");
  });

  test("terminal state: idempotent resolve/reject, run rejects after close", async () => {
    const resolved = await createTransactionContext(mockRunInTransaction);
    await resolved.resolve();
    await resolved.resolve();
    expect(resolved.status).toBe("resolved");
    await expect(resolved.run(async () => 1)).rejects.toThrow("Transaction is already resolved");

    const rejected = await createTransactionContext(mockRunInTransaction);
    await rejected.reject(new Error("rollback"));
    await rejected.reject(new Error("second"));
    expect(rejected.status).toBe("rejected");
    await expect(rejected.run(async () => 1)).rejects.toThrow("Transaction is already rejected");
  });

  test("run callback receives transactionHooks", async () => {
    const ctx = await createTransactionContext(mockRunInTransaction);

    const hookKey = Symbol("test");
    await ctx.run(async (_txCtx, transactionHooks) => {
      transactionHooks.getOrInsert(hookKey, () => ({
        state: ["event-1"],
        flush: () => {},
      }));

      expect(transactionHooks.has(hookKey)).toBe(true);
      expect(transactionHooks.get<string[]>(hookKey)).toEqual(["event-1"]);
    });

    await ctx.resolve();
  });

  test("resolve flushes hooks after committing transaction", async () => {
    const flushed: string[] = [];
    let transactionCommitted = false;

    const runInTransaction = async (callback: (txCtx: unknown) => Promise<void>) => {
      await callback(undefined);
      transactionCommitted = true;
    };

    const ctx = await createTransactionContext(runInTransaction);
    const hookKey = Symbol("test");

    await ctx.run(async (_txCtx, transactionHooks) => {
      transactionHooks.getOrInsert(hookKey, () => ({
        state: ["event-a", "event-b"],
        flush: (state) => {
          expect(transactionCommitted).toBe(true);
          flushed.push(...state);
        },
      }));
    });

    await ctx.resolve();

    expect(flushed).toEqual(["event-a", "event-b"]);
  });

  test("reject discards hooks after rolling back transaction", async () => {
    const discarded: string[] = [];

    const ctx = await createTransactionContext(mockRunInTransaction);
    const hookKey = Symbol("test");

    await ctx.run(async (_txCtx, transactionHooks) => {
      transactionHooks.getOrInsert(hookKey, () => ({
        state: ["event-a"],
        flush: () => {
          throw new Error("should not flush");
        },
        discard: (state) => {
          discarded.push(...state);
        },
      }));
    });

    await ctx.reject(new Error("rollback"));

    expect(discarded).toEqual(["event-a"]);
  });

  test("each context gets independent transactionHooks", async () => {
    const ctx1 = await createTransactionContext(mockRunInTransaction);
    const ctx2 = await createTransactionContext(mockRunInTransaction);

    const key = Symbol("test");
    let hooks1!: TransactionHooks;
    let hooks2!: TransactionHooks;
    await ctx1.run(async (_txCtx, hooks) => {
      hooks1 = hooks;
    });
    await ctx2.run(async (_txCtx, hooks) => {
      hooks2 = hooks;
    });

    hooks1.set(key, {
      state: "ctx1",
      flush: () => {},
    });

    expect(hooks1.has(key)).toBe(true);
    expect(hooks2.has(key)).toBe(false);

    await ctx1.resolve();
    await ctx2.resolve();
  });
});
