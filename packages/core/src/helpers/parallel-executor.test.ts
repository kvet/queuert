import { describe, expect, test } from "vitest";
import { createParallelExecutor } from "./parallel-executor.js";

describe("createParallelExecutor", () => {
  test("executes task and returns result", async () => {
    const executor = createParallelExecutor(2);
    const result = await executor.add(async () => "hello");
    expect(result).toBe("hello");
  });

  test("tracks active slots correctly", async () => {
    const executor = createParallelExecutor(3);
    expect(executor.activeSlots()).toBe(0);

    const { promise: promise1, resolve: resolve1 } = Promise.withResolvers<void>();
    const task1 = executor.add(async () => promise1);
    expect(executor.activeSlots()).toBe(1);

    const { promise: promise2, resolve: resolve2 } = Promise.withResolvers<void>();
    const task2 = executor.add(async () => promise2);
    expect(executor.activeSlots()).toBe(2);

    resolve1();
    await task1;
    expect(executor.activeSlots()).toBe(1);

    resolve2();
    await task2;
    expect(executor.activeSlots()).toBe(0);
  });

  test("tracks idle slots correctly", async () => {
    const executor = createParallelExecutor(3);
    expect(executor.idleSlots()).toBe(3);

    const { promise: promise1, resolve: resolve1 } = Promise.withResolvers<void>();
    const task1 = executor.add(async () => promise1);
    expect(executor.idleSlots()).toBe(2);

    const { promise: promise2, resolve: resolve2 } = Promise.withResolvers<void>();
    const task2 = executor.add(async () => promise2);
    expect(executor.idleSlots()).toBe(1);

    resolve1();
    await task1;
    expect(executor.idleSlots()).toBe(2);

    resolve2();
    await task2;
    expect(executor.idleSlots()).toBe(3);
  });

  test("throws when exceeding maxSlots", async () => {
    const executor = createParallelExecutor(2);

    void executor.add(async () => new Promise(() => {}));
    void executor.add(async () => new Promise(() => {}));

    await expect(executor.add(async () => "overflow")).rejects.toThrow(
      "Cannot add new task, maximum concurrency of 2 reached.",
    );
  });

  test("waitForIdleSlot resolves immediately when slots available", async () => {
    const executor = createParallelExecutor(2);
    void executor.add(async () => new Promise(() => {}));

    await executor.waitForIdleSlot();
    expect(executor.activeSlots()).toBe(1);
  });

  test("waitForIdleSlot waits when at capacity", async () => {
    const executor = createParallelExecutor(1);
    let resolved = false;

    const { promise, resolve: resolveTask } = Promise.withResolvers<void>();
    void executor.add(async () => promise);

    const waitPromise = executor.waitForIdleSlot().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    resolveTask();
    await waitPromise;
    expect(resolved).toBe(true);
  });

  test("decrements active slots when task throws", async () => {
    const executor = createParallelExecutor(2);

    await expect(
      executor.add(async () => {
        throw new Error("task failed");
      }),
    ).rejects.toThrow("task failed");

    expect(executor.activeSlots()).toBe(0);
  });

  test("exposes maxSlots property", () => {
    const executor = createParallelExecutor(5);
    expect(executor.maxSlots).toBe(5);
  });

  test("resolves waiters one at a time to prevent race conditions", async () => {
    const executor = createParallelExecutor(1);
    const order: string[] = [];

    const { promise, resolve: resolveTask } = Promise.withResolvers<void>();
    void executor.add(async () => promise);

    const waiter1 = executor.waitForIdleSlot().then(async () => {
      order.push("waiter1-resolved");
      await executor.add(async () => {
        order.push("waiter1-task");
      });
    });

    const waiter2 = executor.waitForIdleSlot().then(async () => {
      order.push("waiter2-resolved");
      await executor.add(async () => {
        order.push("waiter2-task");
      });
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    resolveTask();
    await waiter1;
    await waiter2;

    expect(order).toEqual(["waiter1-resolved", "waiter1-task", "waiter2-resolved", "waiter2-task"]);
  });
});
