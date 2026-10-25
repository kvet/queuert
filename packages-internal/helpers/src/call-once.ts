export const createCallOnce = <TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => Generator<unknown, TResult, unknown>,
): {
  call: (...args: TArgs) => Generator<unknown, TResult, unknown>;
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
    *call(...args) {
      throwLatchedFailure();
      if (started) {
        throw new Error(`${name} can only be called once`);
      }
      started = true;
      try {
        const value = yield* fn(...args);
        result = { value };
        return value;
      } catch (error) {
        failure = { error };
        throw error;
      }
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
