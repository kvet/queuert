import { isThenable } from "./promise.ts";

/**
 * Wraps `fn` so each of its failures reaches `onError` once before it propagates: a synchronous
 * throw rethrows and a rejection rejects. With `rejectSyncThrows`, for a function whose callers
 * expect a promise, a synchronous throw comes back as a rejection instead.
 */
export const reportErrors = <T extends (...args: never[]) => unknown>(
  fn: T,
  onError: (error: unknown) => void,
  { rejectSyncThrows = false }: { rejectSyncThrows?: boolean } = {},
): T => {
  const rethrow = (error: unknown): never => {
    onError(error);
    throw error;
  };
  return ((...args) => {
    let result: unknown;
    try {
      result = fn(...args);
    } catch (error) {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- passes the caught value on unchanged
      if (rejectSyncThrows) return Promise.reject(error).catch(rethrow);
      return rethrow(error);
    }
    return isThenable(result) ? (result as Promise<unknown>).catch(rethrow) : result;
  }) as T;
};
