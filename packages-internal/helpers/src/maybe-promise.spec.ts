import { describe, expect, test } from "vitest";

import { all, andThen, mapSeries, requireSync, tryCatch, tryFinally } from "./maybe-promise.ts";

describe("andThen", () => {
  test("calls onValue synchronously for a plain value", () => {
    expect(andThen(1, (value) => value + 1)).toBe(2);
  });

  test("chains onValue after a promise", async () => {
    const result = andThen(Promise.resolve(1), (value) => value + 1);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe(2);
  });
});

describe("tryCatch", () => {
  test("catches a synchronous throw synchronously", () => {
    expect(
      tryCatch(
        () => {
          throw new Error("boom");
        },
        (error) => (error as Error).message,
      ),
    ).toBe("boom");
  });

  test("catches a rejection", async () => {
    await expect(
      tryCatch(
        async () => Promise.reject(new Error("boom")),
        (error) => (error as Error).message,
      ),
    ).resolves.toBe("boom");
  });
});

describe("tryFinally", () => {
  test("runs onFinally synchronously after a plain value or a throw", () => {
    const calls: string[] = [];
    expect(
      tryFinally(
        () => 1,
        () => {
          calls.push("finally");
        },
      ),
    ).toBe(1);
    expect(() =>
      tryFinally(
        () => {
          throw new Error("boom");
        },
        () => {
          calls.push("finally");
        },
      ),
    ).toThrow("boom");
    expect(calls).toEqual(["finally", "finally"]);
  });

  test("runs onFinally after a promise settles", async () => {
    const calls: string[] = [];
    const resolved = tryFinally(
      async () => 1,
      () => {
        calls.push("resolved");
      },
    );
    const rejected = tryFinally(
      async () => Promise.reject(new Error("boom")),
      () => {
        calls.push("rejected");
      },
    );
    expect(calls).toEqual([]);
    await expect(resolved).resolves.toBe(1);
    await expect(rejected).rejects.toThrow("boom");
    expect(calls).toEqual(["resolved", "rejected"]);
  });
});

describe("all", () => {
  test("returns the values synchronously when none is a promise", () => {
    expect(all([1, 2])).toEqual([1, 2]);
  });

  test("awaits the values when one is a promise", async () => {
    await expect(all([1, Promise.resolve(2)])).resolves.toEqual([1, 2]);
  });
});

describe("mapSeries", () => {
  test("maps synchronously until a promise, then in order", async () => {
    const calls: number[] = [];
    const result = mapSeries([1, 2, 3], (value) => {
      calls.push(value);
      return value === 2 ? Promise.resolve(value * 10) : value * 10;
    });
    expect(calls).toEqual([1, 2]);
    await expect(result).resolves.toEqual([10, 20, 30]);
    expect(calls).toEqual([1, 2, 3]);
  });

  test("returns the results synchronously when no step returns a promise", () => {
    expect(mapSeries([1, 2], (value) => value * 10)).toEqual([10, 20]);
  });
});

describe("requireSync", () => {
  test("returns a plain value and throws on a promise", () => {
    expect(requireSync(1, "not sync")).toBe(1);
    expect(() => requireSync(Promise.resolve(1), "not sync")).toThrow("not sync");
  });
});
