export const reportErrors = <T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  onError: (error: unknown) => void,
): T => {
  const rethrow = (error: unknown): never => {
    onError(error);
    throw error;
  };
  // oxlint-disable-next-line typescript/promise-function-async -- an async wrapper would add a promise per adapter call
  return ((...args) => {
    try {
      return Promise.resolve(fn(...args)).catch(rethrow);
    } catch (error) {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- re-rejecting a caught error
      return Promise.reject(error).catch(rethrow);
    }
  }) as T;
};
