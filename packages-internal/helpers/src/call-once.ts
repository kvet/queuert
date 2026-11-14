import { type MaybePromise, step, syncAsync } from "@queuert/sync-async";

export const createCallOnce = <TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => MaybePromise<TResult>,
  { sync }: { sync: boolean },
): {
  call: (...args: TArgs) => MaybePromise<TResult>;
  requireResult: (missingMessage: string) => TResult;
} => {
  let started = false;
  let result: { value: TResult } | null = null;
  let failure: { error: unknown } | null = null;

  const throwLatchedFailure = () => {
    if (failure !== null) {
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing the latched error
      throw failure.error;
    }
  };

  const latchOutcome = syncAsync(function* (args: TArgs) {
    try {
      const value = yield* step(fn(...args));
      result = { value };
      return value;
    } catch (error) {
      failure = { error };
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
      throw error;
    }
  });
  const run = sync ? latchOutcome.sync : latchOutcome.async;

  return {
    call: (...args) => {
      throwLatchedFailure();
      if (started) {
        throw new Error(`${name} can only be called once`);
      }
      started = true;
      return run(args);
    },
    requireResult: (missingMessage) => {
      throwLatchedFailure();
      if (result === null) {
        throw new Error(missingMessage);
      }
      return result.value;
    },
  };
};
