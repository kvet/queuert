import { describe, expect, test } from "vitest";

import { runOperation } from "./operation.js";

describe("runOperation", () => {
  test("feeds plain values back synchronously in sync mode", () => {
    const result = runOperation("sync", function* () {
      const a = (yield 1) as number;
      const b = (yield 2) as number;
      return a + b;
    });
    expect(result).toBe(3);
  });

  test("throws into the operation when sync mode meets a promise", () => {
    expect(() => {
      runOperation("sync", function* () {
        yield Promise.resolve(1);
      });
    }).toThrow("callbacks passed in sync mode must be synchronous");
  });

  test("awaits yielded values and rejects instead of throwing in async mode", async () => {
    await expect(
      runOperation("async", function* () {
        return ((yield Promise.resolve(2)) as number) * 2;
      }),
    ).resolves.toBe(4);

    const rejected = runOperation("async", function* (): Generator<unknown, never, unknown> {
      yield undefined;
      throw new Error("boom");
    });
    expect(rejected).toBeInstanceOf(Promise);
    await expect(rejected).rejects.toThrow("boom");
  });

  test("routes a rejected yield into the operation's catch", async () => {
    const result = await runOperation("async", function* () {
      try {
        yield Promise.reject(new Error("boom"));
        return "not reached";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(result).toBe("boom");
  });
});
