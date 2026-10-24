/**
 * Wraps `fn` so it runs at most once and latches its failure. After a failed call, every later
 * `call` and `requireResult` re-throws the same error, so a caller that catches it cannot carry on
 * as if nothing happened.
 */
export const createCallOnce = <TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult>,
): {
  call: (...args: TArgs) => Promise<TResult>;
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
    call: async (...args) => {
      throwLatchedFailure();
      if (started) {
        throw new Error(`${name} can only be called once`);
      }
      started = true;
      try {
        const value = await fn(...args);
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
