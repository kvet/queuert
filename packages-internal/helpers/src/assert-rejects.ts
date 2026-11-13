import assert, { type AssertPredicate } from "node:assert/strict";

import { type MaybePromise, isPromise } from "./maybe-promise.ts";

const check = (error: unknown, expected: AssertPredicate | undefined): void => {
  const rethrow = (): never => {
    throw error;
  };
  if (expected === undefined) {
    assert.throws(rethrow);
  } else {
    assert.throws(rethrow, expected);
  }
};

/**
 * Asserts that `fn` throws, or returns a promise that rejects, with an error that matches `error`
 * when given. Returns a promise only when `fn` returned one, so a synchronous throw is checked
 * synchronously.
 */
export const assertRejects = (fn: () => unknown, error?: AssertPredicate): MaybePromise<void> => {
  let result: unknown;
  try {
    result = fn();
  } catch (caught) {
    check(caught, error);
    return;
  }
  if (isPromise(result)) {
    return result.then(
      () => {
        assert.fail("Expected the function to reject, but it resolved");
      },
      (caught: unknown) => {
        check(caught, error);
      },
    );
  }
  assert.fail("Expected the function to throw, but it returned");
};
