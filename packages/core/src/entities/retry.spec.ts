import { afterEach, describe, expect, test, vi } from "vitest";

import { retryConfigViolations, withRetry } from "./retry.ts";

const config = { maxTries: 3, initialDelayMs: 10, maxDelayMs: 100 };

describe("withRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("runs fn again after a retryable error, passing the try number", async () => {
    const tryNumbers: number[] = [];

    const result = await withRetry(
      async (tryNumber) => {
        tryNumbers.push(tryNumber);
        if (tryNumber < 3) throw new Error("conflict");
        return "done";
      },
      config,
      () => true,
    );

    expect(result).toBe("done");
    expect(tryNumbers).toEqual([1, 2, 3]);
  });

  test("throws the error of the last try once maxTries tries failed", async () => {
    let tries = 0;

    await expect(
      withRetry(
        async (tryNumber) => {
          tries++;
          throw new Error(`conflict ${tryNumber}`);
        },
        config,
        () => true,
      ),
    ).rejects.toThrow("conflict 3");
    expect(tries).toBe(3);
  });

  test("throws an error that is not retryable without another try", async () => {
    let tries = 0;

    await expect(
      withRetry(
        async () => {
          tries++;
          throw new Error("other");
        },
        config,
        () => false,
      ),
    ).rejects.toThrow("other");
    expect(tries).toBe(1);
  });

  test("waits a random delay up to the backoff delay of the failed try", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const startedAt: number[] = [];

    const result = withRetry(
      async (tryNumber) => {
        startedAt.push(Date.now());
        if (tryNumber < 3) throw new Error("conflict");
        return "done";
      },
      config,
      () => true,
    );
    await vi.runAllTimersAsync();

    expect(await result).toBe("done");
    expect([startedAt[1] - startedAt[0], startedAt[2] - startedAt[1]]).toEqual([10, 20]);
  });
});

describe("retryConfigViolations", () => {
  test("lists a maxTries that is not a positive integer and every invalid backoff field", () => {
    expect(retryConfigViolations("retry", config)).toEqual([]);
    expect(
      retryConfigViolations("retry", { maxTries: 1.5, initialDelayMs: -1, maxDelayMs: 100 }),
    ).toEqual([
      "retry.maxTries must be a positive integer (got 1.5)",
      "retry.initialDelayMs must be a non-negative finite number (got -1)",
    ]);
    for (const maxTries of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(retryConfigViolations("retry", { ...config, maxTries })).toHaveLength(1);
    }
  });
});
