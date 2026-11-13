import { describe, expect, test } from "vitest";

import { runSteps, step } from "./steps.ts";

describe("runSteps", () => {
  test("runs a body synchronously over plain values", () => {
    const result = runSteps(
      (function* () {
        const a = yield* step(1);
        const b = yield* step(a + 1);
        return a + b;
      })(),
      true,
    );
    expect(result).toBe(3);
  });

  test("throws when a synchronous run gets a promise", () => {
    expect(() =>
      runSteps(
        (function* () {
          return yield* step(Promise.resolve(1));
        })(),
        true,
      ),
    ).toThrow("A synchronous step got a promise");
  });

  test("awaits each step and throws rejections into the body", async () => {
    const result = runSteps(
      (function* () {
        const a = yield* step(Promise.resolve(1));
        try {
          yield* step(Promise.reject(new Error("boom")));
        } catch (error) {
          return `${a} ${(error as Error).message}`;
        }
        return "unreachable";
      })(),
      false,
    );
    await expect(result).resolves.toBe("1 boom");
  });
});
