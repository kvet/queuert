export const reportErrors = <T extends (...args: never[]) => unknown>(
  fn: T,
  onError: (error: unknown) => void,
): T =>
  ((...args) => {
    try {
      return fn(...args);
    } catch (error) {
      onError(error);
      throw error;
    }
  }) as T;
