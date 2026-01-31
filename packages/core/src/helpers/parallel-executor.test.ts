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

  test("onIdleSlot calls listener when slot becomes available", async () => {
    const executor = createParallelExecutor(1);
    let called = false;

    const { promise, resolve: resolveTask } = Promise.withResolvers<void>();
    const task = executor.add(async () => promise);

    executor.onIdleSlot(() => {
      called = true;
    });

    await Promise.resolve();
    expect(called).toBe(false);

    resolveTask();
    await task;
    expect(called).toBe(true);
  });

  test("onIdleSlot fires on every task completion", async () => {
    const executor = createParallelExecutor(3);
    let callCount = 0;

    executor.onIdleSlot(() => {
      callCount++;
    });

    const { promise: p1, resolve: r1 } = Promise.withResolvers<void>();
    const { promise: p2, resolve: r2 } = Promise.withResolvers<void>();

    const task1 = executor.add(async () => p1);
    const task2 = executor.add(async () => p2);

    expect(executor.idleSlots()).toBe(1);

    r1();
    await task1;
    expect(callCount).toBe(1);

    r2();
    await task2;
    expect(callCount).toBe(2);
  });

  test("onIdleSlot fires even when idle slots already exist", async () => {
    const executor = createParallelExecutor(3);
    let callCount = 0;

    executor.onIdleSlot(() => {
      callCount++;
    });

    const { promise, resolve: resolveTask } = Promise.withResolvers<void>();
    const task = executor.add(async () => promise);

    expect(executor.idleSlots()).toBe(2);

    resolveTask();
    await task;

    expect(callCount).toBe(1);
  });

  test("onIdleSlot dispose removes listener", async () => {
    const executor = createParallelExecutor(1);
    let called = false;

    const { promise, resolve: resolveTask } = Promise.withResolvers<void>();
    void executor.add(async () => promise);

    const dispose = executor.onIdleSlot(() => {
      called = true;
    });
    dispose();

    resolveTask();
    await Promise.resolve();
    expect(called).toBe(false);
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

  test("drain resolves immediately when no active tasks", async () => {
    const executor = createParallelExecutor(2);
    await executor.drain();
    expect(executor.activeSlots()).toBe(0);
  });

  test("drain waits for all active tasks to complete", async () => {
    const executor = createParallelExecutor(3);

    const { promise: p1, resolve: r1 } = Promise.withResolvers<void>();
    const { promise: p2, resolve: r2 } = Promise.withResolvers<void>();

    const task1 = executor.add(async () => p1);
    void executor.add(async () => p2);

    expect(executor.activeSlots()).toBe(2);

    let drained = false;
    const drainPromise = executor.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    r1();
    await task1;
    expect(drained).toBe(false);
    expect(executor.activeSlots()).toBe(1);

    r2();
    await drainPromise;
    expect(drained).toBe(true);
    expect(executor.activeSlots()).toBe(0);
  });

  test("onIdleSlot throws if listener already registered", () => {
    const executor = createParallelExecutor(1);

    executor.onIdleSlot(() => {});

    expect(() => executor.onIdleSlot(() => {})).toThrow(
      "An idle slot listener is already registered.",
    );
  });

  test("drain throws if already draining", async () => {
    const executor = createParallelExecutor(1);

    const { promise } = Promise.withResolvers<void>();
    void executor.add(async () => promise);

    void executor.drain();

    await expect(executor.drain()).rejects.toThrow("A drain listener is already registered.");
  });

  test("add throws after drain completes", async () => {
    const executor = createParallelExecutor(2);

    await executor.drain();

    await expect(executor.add(async () => "test")).rejects.toThrow(
      "Executor has been drained and cannot accept new tasks.",
    );
  });

  test("add throws after drain with active tasks completes", async () => {
    const executor = createParallelExecutor(2);

    const { promise, resolve } = Promise.withResolvers<void>();
    void executor.add(async () => promise);

    const drainPromise = executor.drain();
    resolve();
    await drainPromise;

    await expect(executor.add(async () => "test")).rejects.toThrow(
      "Executor has been drained and cannot accept new tasks.",
    );
  });
});
