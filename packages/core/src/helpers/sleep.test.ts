import { describe, expect, test, vi } from "vitest";
import { sleep } from "./sleep.js";

describe("sleep", () => {
  test("resolves after specified duration", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(100);
  });

  test("resolves immediately when duration is 0", async () => {
    const start = Date.now();
    await sleep(0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  test("resolves immediately when duration is negative", async () => {
    const start = Date.now();
    await sleep(-100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  test("applies jitter within expected range", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await sleep(50, { jitterMs: 20 });
      durations.push(Date.now() - start);
    }
    // With jitterMs=20, actual sleep should be 50 ± 10ms (40-60ms range)
    // Allow some tolerance for timing
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(35);
    expect(Math.max(...durations)).toBeLessThan(100);
  });

  test("resolves immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const start = Date.now();
    await sleep(1000, { signal: controller.signal });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  test("resolves early when signal is aborted during sleep", async () => {
    const controller = new AbortController();

    const start = Date.now();
    setTimeout(() => controller.abort(), 30);
    await sleep(1000, { signal: controller.signal });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(100);
  });

  test("cleans up abort listener after normal completion", async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    await sleep(10, { signal: controller.signal });

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
