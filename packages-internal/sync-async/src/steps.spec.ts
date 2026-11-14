import { describe, expect, test } from "vitest";

import type { MaybePromise } from "./maybe-promise.ts";
import { runSteps, step, type Steps, syncStep, withResources } from "./steps.ts";

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
    expect((): MaybePromise<number> =>
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

  test("throws for an async generator body", () => {
    const body = async function* () {
      yield* step(1);
    };
    expect((): MaybePromise<void> => runSteps(body() as unknown as Steps<void>, true)).toThrow(
      "A sync-async body must be a generator function, not an async generator one",
    );
  });
});

describe("syncStep", () => {
  test("returns a plain value and throws on a promise", () => {
    expect(syncStep(1)).toBe(1);
    expect(() => syncStep(Promise.resolve(1))).toThrow(
      "A synchronous step got a promise: the value must be synchronous",
    );
  });
});

describe("withResources", () => {
  test("disposes what the body used in reverse order once it settles, skipping null", async () => {
    const events: string[] = [];
    const handle = (name: string) => ({ [Symbol.dispose]: () => void events.push(name) });

    const result = await withResources(async (resources) => {
      resources.use(handle("first"));
      resources.use(null);
      resources.use(handle("second"));
      events.push("body");
      return "done";
    });

    expect(result).toBe("done");
    expect(events).toEqual(["body", "second", "first"]);
  });

  test("rejects a value that is not disposable", async () => {
    await expect(
      withResources(async (resources) => {
        resources.use({});
      }),
    ).rejects.toThrow("A resource got a value that is neither async disposable nor disposable");
  });
});
