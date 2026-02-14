import { describe, expect, test } from "vitest";
import { sleep } from "./sleep.js";
import { createTransactionContext } from "./transaction-context.js";

describe("createTransactionContext", () => {
  test("resolve lifecycle: passes txContext, returns values, drains work, closes transaction", async () => {
    const mockTx = { client: "mock-client", id: 42 };
    let transactionEnded = false;

    const runInTransaction = async (callback: (txContext: typeof mockTx) => Promise<void>) => {
      await callback(mockTx);
      transactionEnded = true;
    };

    const ctx = await createTransactionContext(runInTransaction);
    expect(ctx.status).toBe("pending");
    expect(transactionEnded).toBe(false);

    const received = await ctx.run(async (txContext) => txContext);
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
    const mockRunInTransaction = async (callback: (txContext: unknown) => Promise<void>) => {
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

  // TODO: add async context propagation test when AsyncResource.bind support is restored

  test("reject lifecycle: propagates errors and rolls back", async () => {
    let transactionError: unknown;

    const runInTransaction = async (callback: (txContext: unknown) => Promise<void>) => {
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
    const mockRunInTransaction = async (callback: (txContext: unknown) => Promise<void>) => {
      await callback(undefined);
    };

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
});
