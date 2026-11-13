import { expectToThrow } from "@queuert/helpers/expect.spec-helper";
import { describe, expect, test, vi } from "vitest";

import { createCallOnce } from "./call-once.ts";

describe("createCallOnce", () => {
  test("passes arguments through and returns the result", async () => {
    const fn = vi.fn(async (a: number, b: number) => a + b);
    const once = createCallOnce("add", fn);

    expect(await once.call(1, 2)).toBe(3);
    expect(fn).toHaveBeenCalledWith(1, 2);
    expect(once.requireResult("add was not called")).toBe(3);
  });

  test("throws on a second call without running fn again", async () => {
    const fn = vi.fn(async () => "value");
    const once = createCallOnce("complete", fn);

    await once.call();
    await expectToThrow(async () => {
      await once.call();
    }, "complete can only be called once");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("latches a failure for later calls and requireResult", async () => {
    const error = new Error("boom");
    const fn = vi.fn(async () => {
      throw error;
    });
    const once = createCallOnce("complete", fn);

    await expectToThrow(async () => {
      await once.call();
    }, error);
    await expectToThrow(async () => {
      await once.call();
    }, error);
    expect(() => once.requireResult("complete was not called")).toThrow(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("requireResult throws the given message when fn was never called", () => {
    const once = createCallOnce("complete", async () => "value");

    expect(() => once.requireResult("complete was not called")).toThrow("complete was not called");
  });

  test("throws on a concurrent call while the first is in flight", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const once = createCallOnce("complete", async () => promise);

    const first = once.call();
    expect(() => once.call()).toThrow("complete can only be called once");
    resolve("value");
    await expect(first).resolves.toBe("value");
  });

  test("returns a synchronous fn's result without a promise", () => {
    const once = createCallOnce("complete", (value: number) => value + 1);

    expect(once.call(1)).toBe(2);
    expect(once.requireResult("complete was not called")).toBe(2);
  });

  test("latches a synchronous throw", () => {
    const error = new Error("boom");
    const once = createCallOnce("complete", () => {
      throw error;
    });

    expect(() => once.call()).toThrow(error);
    expect(() => once.call()).toThrow(error);
    expect(() => once.requireResult("complete was not called")).toThrow(error);
  });
});
