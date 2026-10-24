import { describe, expect, test, vi } from "vitest";

import { createCallOnce } from "./call-once.js";

describe("createCallOnce", () => {
  test("passes arguments through and returns the result", async () => {
    const fn = vi.fn(async (a: number, b: number) => a + b);
    const once = createCallOnce("add", fn);

    await expect(once.call(1, 2)).resolves.toBe(3);
    expect(fn).toHaveBeenCalledWith(1, 2);
    expect(once.requireResult("add was not called")).toBe(3);
  });

  test("rejects a second call without running fn again", async () => {
    const fn = vi.fn(async () => "value");
    const once = createCallOnce("complete", fn);

    await once.call();
    await expect(once.call()).rejects.toThrow("complete can only be called once");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("rejects a concurrent call while the first is in flight", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const once = createCallOnce("complete", async () => promise);

    const first = once.call();
    await expect(once.call()).rejects.toThrow("complete can only be called once");
    resolve("value");
    await expect(first).resolves.toBe("value");
  });

  test("latches a failure for later calls and requireResult", async () => {
    const error = new Error("boom");
    const fn = vi.fn(async () => {
      throw error;
    });
    const once = createCallOnce("complete", fn);

    await expect(once.call()).rejects.toBe(error);
    await expect(once.call()).rejects.toBe(error);
    expect(() => once.requireResult("complete was not called")).toThrow(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("requireResult throws the given message when fn was never called", () => {
    const once = createCallOnce("complete", async () => "value");

    expect(() => once.requireResult("complete was not called")).toThrow("complete was not called");
  });
});
