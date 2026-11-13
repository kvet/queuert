import { type MaybePromise, andThen, tryCatch } from "./maybe-promise.ts";

export const createCallOnce = <TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => MaybePromise<TResult>,
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

  return {
    call: (...args) => {
      throwLatchedFailure();
      if (started) {
        throw new Error(`${name} can only be called once`);
      }
      started = true;
      return tryCatch(
        () =>
          andThen(fn(...args), (value) => {
            result = { value };
            return value;
          }),
        (error) => {
          failure = { error };
          // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
          throw error;
        },
      );
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
