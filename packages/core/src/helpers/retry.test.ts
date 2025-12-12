import { describe, expect, test, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn, { maxRetries: 3 }, { isRetryableError: () => true });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries on retryable errors", async () => {
    const retryableError = new Error("temporary failure");

    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValue("success");

    const result = await withRetry(
      fn,
      {
        maxRetries: 3,
        initialIntervalMs: 1,
        backoffCoefficient: 1,
      },
      { isRetryableError: () => true },
    );

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("throws immediately on non-retryable errors", async () => {
    const nonRetryableError = new Error("permanent failure");

    const fn = vi.fn().mockRejectedValue(nonRetryableError);

    await expect(
      withRetry(fn, { maxRetries: 3, initialIntervalMs: 1 }, { isRetryableError: () => false }),
    ).rejects.toThrow("permanent failure");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("throws after maxRetries exhausted", async () => {
    const retryableError = new Error("temporary failure");

    const fn = vi.fn().mockRejectedValue(retryableError);

    await expect(
      withRetry(fn, { maxRetries: 3, initialIntervalMs: 1 }, { isRetryableError: () => true }),
    ).rejects.toThrow("temporary failure");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("applies exponential backoff", async () => {
    const retryableError = new Error("temporary failure");

    const fn = vi.fn().mockRejectedValue(retryableError);
    const startTime = Date.now();

    await expect(
      withRetry(
        fn,
        {
          maxRetries: 3,
          initialIntervalMs: 10,
          backoffCoefficient: 2,
        },
        { isRetryableError: () => true },
      ),
    ).rejects.toThrow();

    const elapsed = Date.now() - startTime;
    // Should wait ~10ms + ~20ms = ~30ms (with some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(100);
  });

  test("respects abort signal", async () => {
    const retryableError = new Error("temporary failure");

    const fn = vi.fn().mockRejectedValue(retryableError);
    const controller = new AbortController();

    // Abort after a short delay
    setTimeout(() => controller.abort(), 5);

    await expect(
      withRetry(
        fn,
        { maxRetries: 10, initialIntervalMs: 50, backoffCoefficient: 1 },
        { signal: controller.signal, isRetryableError: () => true },
      ),
    ).rejects.toThrow();

    // Should have been interrupted before all retries
    expect(fn.mock.calls.length).toBeLessThan(10);
  });

  test("uses custom isRetryableError function", async () => {
    const customError = new Error("custom error");

    const fn = vi.fn().mockRejectedValueOnce(customError).mockResolvedValue("success");

    const result = await withRetry(
      fn,
      { maxRetries: 3, initialIntervalMs: 1 },
      { isRetryableError: (error) => error instanceof Error && error.message === "custom error" },
    );

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("retry by default", async () => {
    const error = new Error("any error");

    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { maxRetries: 3, initialIntervalMs: 1 })).rejects.toThrow(
      "any error",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
