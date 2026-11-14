import { describe, expect, test } from "vitest";

import {
  all,
  andThen,
  isPromise,
  isThenable,
  type MaybePromise,
  requireSync,
  silence,
  tryCatch,
  tryFinally,
} from "./maybe-promise.ts";

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
    expect((): MaybePromise<number> =>
      tryFinally(
        (): number => {
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

describe("requireSync", () => {
  test("returns a plain value and throws on a promise", () => {
    expect(requireSync(1, "not sync")).toBe(1);
    expect(() => requireSync(Promise.resolve(1), "not sync")).toThrow("not sync");
  });
});

describe("isThenable", () => {
  test("accepts promises and objects or functions with a then method", () => {
    expect(isThenable(Promise.resolve())).toBe(true);
    // oxlint-disable-next-line unicorn/no-thenable -- the case needs a thenable that is not a promise
    expect(isThenable({ then: () => {} })).toBe(true);
    // oxlint-disable-next-line unicorn/no-thenable -- the case needs a thenable that is not a promise
    expect(isThenable(Object.assign(() => {}, { then: () => {} }))).toBe(true);
  });

  test("rejects values without a then method", () => {
    expect(isThenable(null)).toBe(false);
    expect(isThenable(undefined)).toBe(false);
    expect(isThenable(42)).toBe(false);
    // oxlint-disable-next-line unicorn/no-thenable -- the case needs a then property that is not a function
    expect(isThenable({ then: 1 })).toBe(false);
    expect(isThenable(() => {})).toBe(false);
  });
});

describe("isPromise", () => {
  test("tells a promise from a plain value", () => {
    expect(isPromise(Promise.resolve(1))).toBe(true);
    expect(isPromise(1)).toBe(false);
    expect(isPromise<number | undefined>(undefined)).toBe(false);
  });
});

describe("silence", () => {
  test("handles a rejection so it is not reported as unhandled", async () => {
    const rejected = Promise.reject(new Error("ignored"));
    silence(rejected);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(rejected).rejects.toThrow("ignored");
  });
});
