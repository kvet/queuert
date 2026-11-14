import { isThenable, silence, type MaybePromise } from "./maybe-promise.ts";

declare const stepToken: unique symbol;
declare const waitToken: unique symbol;

export type StepYield = { readonly [stepToken]: true };
export type WaitYield = { readonly [waitToken]: true };

export type Steps<T, TYield extends StepYield | WaitYield = StepYield | WaitYield> = Generator<
  TYield,
  T,
  unknown
>;

const waitKey = Symbol("queuert.syncAsync.wait");
const resourceKey = Symbol("queuert.syncAsync.resource");

export function* step<T>(value: PromiseLike<T> | T): Generator<StepYield, T, unknown> {
  return (yield value as unknown as StepYield) as T;
}

export function* wait<T>(value: PromiseLike<T> | T): Generator<WaitYield, T, unknown> {
  return (yield { [waitKey]: value } as unknown as WaitYield) as T;
}

export function* resource<T extends AsyncDisposable | Disposable | null | undefined>(
  value: PromiseLike<T> | T,
): Generator<WaitYield, T, unknown> {
  return (yield { [resourceKey]: value } as unknown as WaitYield) as T;
}

export const syncStep = <T>(value: MaybePromise<T>): T => {
  if (isThenable(value)) {
    silence(value);
    throw new Error("A synchronous step got a promise: the value must be synchronous");
  }
  return value;
};

export const withResources = async <T>(
  body: (resources: { use: <TValue>(value: TValue) => TValue }) => Promise<T>,
): Promise<T> => {
  const disposers: (() => MaybePromise<void>)[] = [];
  const resources = {
    use: <TValue>(value: TValue): TValue => {
      if (value === null || value === undefined) return value;
      if (typeof value === "object" && Symbol.asyncDispose in value) {
        const asyncDispose = value[Symbol.asyncDispose];
        if (typeof asyncDispose === "function") {
          disposers.push(async () => asyncDispose.call(value));
          return value;
        }
      }
      if (typeof value === "object" && Symbol.dispose in value) {
        const dispose = value[Symbol.dispose];
        if (typeof dispose === "function") {
          disposers.push(() => {
            dispose.call(value);
          });
          return value;
        }
      }
      throw new TypeError("A resource got a value that is neither async disposable nor disposable");
    },
  };
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: await body(resources) };
  } catch (error) {
    outcome = { error };
  }
  for (let index = disposers.length - 1; index >= 0; index--) {
    try {
      await disposers[index]();
    } catch (error) {
      outcome = {
        error:
          "error" in outcome
            ? new SuppressedError(error, outcome.error, "An error was suppressed during disposal")
            : error,
      };
    }
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
};

type Instruction =
  | { kind: "step"; value: unknown }
  | { kind: "wait"; value: unknown }
  | { kind: "resource"; value: unknown };

export const decode = (yielded: unknown): Instruction => {
  if (typeof yielded === "object" && yielded !== null) {
    if (waitKey in yielded) return { kind: "wait", value: yielded[waitKey] };
    if (resourceKey in yielded) return { kind: "resource", value: yielded[resourceKey] };
  }
  return { kind: "step", value: yielded };
};

export const startSteps = <T>(steps: Steps<T>): IteratorResult<unknown, T> => {
  const result = steps.next();
  if (isThenable(result)) {
    silence(result);
    throw new TypeError(
      "A sync-async body must be a generator function, not an async generator one",
    );
  }
  return result;
};

const runWaiting = async <T>(
  steps: Steps<T>,
  pending: IteratorResult<unknown, T>,
  sync: boolean,
): Promise<T> =>
  withResources(async (resources) => {
    let result = pending;
    while (result.done !== true) {
      const instruction = decode(result.value);
      let value: unknown;
      try {
        if (instruction.kind === "resource") value = resources.use(await instruction.value);
        else if (instruction.kind === "wait" || !sync) value = await instruction.value;
        else value = syncStep(instruction.value);
      } catch (error) {
        result = steps.throw(error);
        continue;
      }
      result = steps.next(value);
    }
    return result.value;
  });

export const runSteps = <T>(steps: Steps<T>, sync: boolean): MaybePromise<T> => {
  let result = startSteps(steps);
  if (!sync) return runWaiting(steps, result, false);
  while (result.done !== true) {
    const instruction = decode(result.value);
    if (instruction.kind !== "step") return runWaiting(steps, result, true);
    let value: unknown;
    try {
      value = syncStep(instruction.value);
    } catch (error) {
      result = steps.throw(error);
      continue;
    }
    result = steps.next(value);
  }
  return result.value;
};
