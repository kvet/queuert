import { type MaybePromise, requireSync } from "./maybe-promise.ts";

/** A body written as a generator: `yield* step(value)` stands where `await value` would. */
export type Steps<T> = Generator<unknown, T, unknown>;

export function* step<T>(value: MaybePromise<T>): Generator<MaybePromise<T>, T, unknown> {
  return (yield value) as T;
}

export const isSteps = (value: unknown): value is Steps<unknown> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { next?: unknown }).next === "function" &&
  typeof (value as { throw?: unknown }).throw === "function" &&
  typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function";

const runStepsSync = <T>(steps: Steps<T>): T => {
  let result = steps.next();
  while (result.done !== true) {
    result = steps.next(
      requireSync(result.value, "A synchronous step got a promise: the value must be synchronous"),
    );
  }
  return result.value;
};

const runStepsAsync = async <T>(steps: Steps<T>): Promise<T> => {
  let result = steps.next();
  while (result.done !== true) {
    let value: unknown;
    try {
      value = await result.value;
    } catch (error) {
      result = steps.throw(error);
      continue;
    }
    result = steps.next(value);
  }
  return result.value;
};

/** Runs a generator body synchronously, or awaiting each step. */
export const runSteps = <T>(steps: Steps<T>, sync: boolean): MaybePromise<T> =>
  sync ? runStepsSync(steps) : runStepsAsync(steps);
