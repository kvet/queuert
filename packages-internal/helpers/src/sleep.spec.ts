import { describe, expect, test, vi } from "vitest";

import { setLongTimeout, sleep } from "./sleep.js";

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
    setTimeout(() => {
      controller.abort();
    }, 30);
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

describe("setLongTimeout", () => {
  test("waits the full delay when it exceeds the 2^31-1 ms timer limit", () => {
    vi.useFakeTimers();
    try {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const callback = vi.fn();
      setLongTimeout(callback, thirtyDaysMs);

      vi.advanceTimersByTime(thirtyDaysMs - 1000);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not fire once cleared after a re-arm", () => {
    vi.useFakeTimers();
    try {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const callback = vi.fn();
      const clear = setLongTimeout(callback, thirtyDaysMs);

      vi.advanceTimersByTime(25 * 24 * 60 * 60 * 1000);
      clear();
      vi.advanceTimersByTime(thirtyDaysMs);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("fires right away for a NaN delay", () => {
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      setLongTimeout(callback, Number.NaN);

      vi.advanceTimersByTime(0);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sleep beyond the 2^31-1 ms timer limit", () => {
  test("resolves when aborted after a re-arm and leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let resolved = false;
      const sleeping = sleep(30 * 24 * 60 * 60 * 1000, { signal: controller.signal }).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(25 * 24 * 60 * 60 * 1000);
      expect(resolved).toBe(false);

      controller.abort();
      await sleeping;
      expect(resolved).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
