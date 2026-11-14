import assert, { type AssertPredicate } from "node:assert/strict";

import { isPromise, type MaybePromise } from "@queuert/sync-async";

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
