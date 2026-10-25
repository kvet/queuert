export type Operation<T> = Generator<unknown, T, unknown>;

export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === "object" || typeof value === "function") &&
  typeof (value as { then?: unknown }).then === "function";

const runSync = <T>(operation: Operation<T>): T => {
  let step = operation.next();
  while (!step.done) {
    if (isThenable(step.value)) {
      step.value.then(undefined, () => {});
      step = operation.throw(
        new Error(
          "A sync state adapter received a promise: callbacks passed in sync mode must be synchronous",
        ),
      );
    } else {
      step = operation.next(step.value);
    }
  }
  return step.value;
};

const runAsync = async <T>(operation: Operation<T>): Promise<T> => {
  let step = operation.next();
  while (!step.done) {
    let value: unknown;
    try {
      value = await step.value;
    } catch (error) {
      step = operation.throw(error);
      continue;
    }
    step = operation.next(value);
  }
  return step.value;
};

export const runOperation = <TMode extends "sync" | "async", T>(
  mode: TMode,
  operation: () => Operation<T>,
): TMode extends "sync" ? T : Promise<T> =>
  (mode === "sync" ? runSync(operation()) : runAsync(operation())) as TMode extends "sync"
    ? T
    : Promise<T>;

export const unwrap = function* <T>(value: T | PromiseLike<T>): Operation<T> {
  return (yield value) as T;
};
