import { isThenable, silence } from "./promise.ts";

export type MaybePromise<T> = T | Promise<T>;

/** Whether a function returns promises (`"async"`) or plain values (`"sync"`). */
export type Mode = "async" | "sync";

type ModeResults<T> = { async: Promise<T>; sync: T };

/** `Promise<T>` in the `"async"` mode, `T` in the `"sync"` mode, and either for `Mode` itself. */
export type ModeResult<TMode extends Mode, T> = ModeResults<T>[TMode];

export const isPromise = <T>(value: MaybePromise<T>): value is Promise<T> => isThenable(value);

export const andThen = <T, R>(
  value: MaybePromise<T>,
  onValue: (value: T) => MaybePromise<R>,
): MaybePromise<R> => (isPromise(value) ? value.then(onValue) : onValue(value));

export const tryCatch = <T, R = T>(
  fn: () => MaybePromise<T>,
  onError: (error: unknown) => MaybePromise<R>,
): MaybePromise<T | R> => {
  let result: MaybePromise<T>;
  try {
    result = fn();
  } catch (error) {
    return onError(error);
  }
  return isPromise(result) ? result.then(undefined, onError) : result;
};

export const tryFinally = <T>(
  fn: () => MaybePromise<T>,
  onFinally: () => MaybePromise<void>,
): MaybePromise<T> => {
  let result: MaybePromise<T>;
  try {
    result = fn();
  } catch (error) {
    return andThen(onFinally(), () => {
      // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
      throw error;
    });
  }
  if (!isPromise(result)) return andThen(onFinally(), () => result);
  return result.then(
    async (value) => andThen(onFinally(), () => value),
    async (error: unknown) =>
      andThen(onFinally(), () => {
        // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
        throw error;
      }),
  );
};

export const all = <T>(values: MaybePromise<T>[]): MaybePromise<T[]> =>
  values.some(isPromise) ? Promise.all(values) : (values as T[]);

export const mapSeries = <T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => MaybePromise<R>,
): MaybePromise<R[]> => {
  const results: R[] = [];
  const runFrom = (start: number): MaybePromise<R[]> => {
    for (let index = start; index < items.length; index++) {
      const result = fn(items[index], index);
      if (isPromise(result)) {
        return result.then((value) => {
          results.push(value);
          return runFrom(index + 1);
        });
      }
      results.push(result);
    }
    return results;
  };
  return runFrom(0);
};

export const requireSync = <T>(value: MaybePromise<T>, message: string): T => {
  if (isPromise(value)) {
    silence(value);
    throw new Error(message);
  }
  return value;
};
