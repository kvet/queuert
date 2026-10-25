import { describe, expect, test, vi } from "vitest";

import { createCallOnce } from "./call-once.js";
import { runOperation, unwrap } from "./operation.js";

const drive = async <T>(operation: Generator<unknown, T, unknown>): Promise<T> =>
  runOperation("async", () => operation);

describe("createCallOnce", () => {
  test("passes arguments through and returns the result", async () => {
    const fn = vi.fn(function* (a: number, b: number) {
      return yield* unwrap(a + b);
    });
    const once = createCallOnce("add", fn);

    await expect(drive(once.call(1, 2))).resolves.toBe(3);
    expect(fn).toHaveBeenCalledWith(1, 2);
    expect(once.requireResult("add was not called")).toBe(3);
  });

  test("rejects a second call without running fn again", async () => {
    const fn = vi.fn(function* () {
      return yield* unwrap("value");
    });
    const once = createCallOnce("complete", fn);

    await drive(once.call());
    await expect(drive(once.call())).rejects.toThrow("complete can only be called once");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("rejects a concurrent call while the first is in flight", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const once = createCallOnce("complete", function* () {
      return (yield promise) as string;
    });

    const first = drive(once.call());
    await expect(drive(once.call())).rejects.toThrow("complete can only be called once");
    resolve("value");
    await expect(first).resolves.toBe("value");
  });

  test("latches a failure for later calls and requireResult", async () => {
    const error = new Error("boom");
    const fn = vi.fn(function* (): Generator<unknown, string, unknown> {
      yield undefined;
      throw error;
    });
    const once = createCallOnce("complete", fn);

    await expect(drive(once.call())).rejects.toBe(error);
    await expect(drive(once.call())).rejects.toBe(error);
    expect(() => once.requireResult("complete was not called")).toThrow(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("requireResult throws the given message when fn was never called", () => {
    const once = createCallOnce("complete", function* () {
      return yield* unwrap("value");
    });

    expect(() => once.requireResult("complete was not called")).toThrow("complete was not called");
  });
});
