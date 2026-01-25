import { describe, expect, test } from "vitest";
import { createAsyncLock } from "./async-lock.js";

describe("createAsyncLock", () => {
  test("acquires immediately when lock is free", async () => {
    const lock = createAsyncLock();
    await lock.acquire();
    lock.release();
  });

  test("blocks second acquire until release", async () => {
    const lock = createAsyncLock();
    const order: number[] = [];

    await lock.acquire();
    order.push(1);

    const secondAcquire = lock.acquire().then(() => {
      order.push(2);
    });

    await Promise.resolve();
    expect(order).toEqual([1]);

    lock.release();
    await secondAcquire;

    expect(order).toEqual([1, 2]);
  });

  test("processes waiters in FIFO order", async () => {
    const lock = createAsyncLock();
    const order: number[] = [];

    await lock.acquire();

    const waiter1 = lock.acquire().then(() => {
      order.push(1);
      lock.release();
    });
    const waiter2 = lock.acquire().then(() => {
      order.push(2);
      lock.release();
    });
    const waiter3 = lock.acquire().then(() => {
      order.push(3);
      lock.release();
    });

    lock.release();
    await Promise.all([waiter1, waiter2, waiter3]);

    expect(order).toEqual([1, 2, 3]);
  });

  test("serializes concurrent operations", async () => {
    const lock = createAsyncLock();
    let counter = 0;
    const results: number[] = [];

    const operation = async (id: number) => {
      await lock.acquire();
      const current = counter;
      await Promise.resolve();
      counter = current + 1;
      results.push(id);
      lock.release();
    };

    await Promise.all([operation(1), operation(2), operation(3)]);

    expect(counter).toBe(3);
    expect(results).toHaveLength(3);
  });

  test("can be reacquired after release", async () => {
    const lock = createAsyncLock();

    await lock.acquire();
    lock.release();

    await lock.acquire();
    lock.release();

    await lock.acquire();
    lock.release();
  });
});
