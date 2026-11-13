import type { MaybePromise } from "./maybe-promise.ts";
import { isThenable, silence } from "./promise.ts";
import type { Steps } from "./steps.ts";

const waitKey = Symbol("queuert.wait");
const resourceKey = Symbol("queuert.resource");

type Tagged<TKey extends symbol> = { readonly [key in TKey]: unknown };

const isTagged = <TKey extends symbol>(value: unknown, key: TKey): value is Tagged<TKey> =>
  typeof value === "object" && value !== null && key in value;

/**
 * Waits for work that is asynchronous in both modes, such as a worker runner stopping or a
 * notification arriving: `yield* wait(promise)` stands where `await promise` would, in a
 * {@link caseBody}. A rejection is thrown back into the body.
 */
export function* wait<T>(value: PromiseLike<T> | T): Generator<unknown, T, unknown> {
  return (yield { [waitKey]: value }) as T;
}

/**
 * Registers a disposable for the rest of a {@link caseBody}: `yield* resource(value)` stands where
 * `await using` would. The value is awaited in both modes, and the body's resources are disposed
 * in reverse order when it returns or throws.
 */
export function* resource<T extends AsyncDisposable | Disposable>(
  value: PromiseLike<T> | T,
): Generator<unknown, T, unknown> {
  return (yield { [resourceKey]: value }) as T;
}

const settle = async (value: unknown): Promise<{ value: unknown } | { error: unknown }> => {
  try {
    return { value: await value };
  } catch (error) {
    return { error };
  }
};

const disposerOf = (value: unknown): (() => MaybePromise<void>) => {
  if (typeof value === "object" && value !== null) {
    const asyncDispose = (value as Partial<AsyncDisposable>)[Symbol.asyncDispose];
    if (typeof asyncDispose === "function") return async () => asyncDispose.call(value);
    const dispose = (value as Partial<Disposable>)[Symbol.dispose];
    if (typeof dispose === "function")
      return () => {
        dispose.call(value);
      };
  }
  throw new Error("A resource got a value that is neither async disposable nor disposable");
};

/**
 * Turns a generator body into a conformance case's `run`, in the mode of the first resource the
 * body creates, which is the adapter under test: when it has `sync: true`, every
 * `yield* step(value)` must be a plain value, and otherwise it must be a promise, which is
 * awaited. A step before the first resource, or one that breaks its mode, is thrown into the body
 * so its `finally` blocks run, and fails the case even when the body catches it. `wait` and
 * `resource` are awaited in both modes.
 */
export const caseBody =
  <TContext>(body: (context: TContext) => Steps<void>): ((context: TContext) => Promise<void>) =>
  async (context) => {
    let sync: boolean | undefined;
    let violation: Error | undefined;
    const disposers: (() => MaybePromise<void>)[] = [];
    let failure: { error: unknown } | undefined;
    const violate = (yielded: unknown, message: string): { error: unknown } => {
      if (isThenable(yielded)) silence(yielded);
      const error = new Error(message);
      violation ??= error;
      return { error };
    };
    try {
      const steps = body(context);
      let result = steps.next();
      while (result.done !== true) {
        const yielded = result.value;
        let outcome: { value: unknown } | { error: unknown };
        if (isTagged(yielded, waitKey)) {
          outcome = await settle(yielded[waitKey]);
        } else if (isTagged(yielded, resourceKey)) {
          outcome = await settle(yielded[resourceKey]);
          if ("value" in outcome) {
            disposers.push(disposerOf(outcome.value));
            sync ??= (outcome.value as { sync?: unknown }).sync === true;
          }
        } else if (sync === undefined) {
          outcome = violate(
            yielded,
            "A step ran before the first resource, so the case has no mode",
          );
        } else if (sync) {
          outcome = isThenable(yielded)
            ? violate(yielded, "A synchronous step got a promise: the value must be synchronous")
            : { value: yielded };
        } else if (isThenable(yielded)) {
          outcome = await settle(yielded);
        } else {
          outcome = violate(
            yielded,
            "An asynchronous step got a plain value: the value must be a promise",
          );
        }
        result = "error" in outcome ? steps.throw(outcome.error) : steps.next(outcome.value);
      }
      if (violation !== undefined) failure = { error: violation };
    } catch (error) {
      failure = { error: violation ?? error };
    }
    for (let index = disposers.length - 1; index >= 0; index--) {
      try {
        await disposers[index]();
      } catch (error) {
        failure = {
          error:
            failure === undefined
              ? error
              : new SuppressedError(
                  error,
                  failure.error,
                  "An error was suppressed during disposal",
                ),
        };
      }
    }
    if (failure !== undefined) throw failure.error;
  };
