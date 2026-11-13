import { runSteps, type Steps } from "./steps.ts";

/**
 * A function written once as a generator body and run in either mode. Inside the body,
 * `yield* step(value)` stands where `await value` would, and `yield* other.steps(...)` calls another
 * modal function; nothing else may be yielded.
 */
export type Modal<TArgs extends unknown[], TResult> = {
  /** Runs the body synchronously; throws if a step gets a promise. */
  readonly sync: (...args: TArgs) => TResult;
  /** Runs the body awaiting each step; always returns a promise. */
  readonly async: (...args: TArgs) => Promise<TResult>;
  /** The generator body, for `yield*` delegation from another modal body. */
  readonly steps: (...args: TArgs) => Steps<TResult>;
};

export const modal = <TArgs extends unknown[], TResult>(
  steps: (...args: TArgs) => Steps<TResult>,
): Modal<TArgs, TResult> => ({
  steps,
  sync: (...args) => runSteps(steps(...args), true) as TResult,
  async: async (...args) => runSteps(steps(...args), false),
});
