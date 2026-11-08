import { describe, expect, test } from "vitest";

import { isThenable, silence } from "./promise.ts";

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

describe("silence", () => {
  test("handles a rejection so it is not reported as unhandled", async () => {
    const rejected = Promise.reject(new Error("ignored"));
    silence(rejected);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(rejected).rejects.toThrow("ignored");
  });
});
