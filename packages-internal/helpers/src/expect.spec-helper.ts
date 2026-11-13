import { expect } from "vitest";

import { assertRejects } from "./assert-rejects.ts";
import type { MaybePromise } from "./maybe-promise.ts";

export const expectToThrow = (
  fn: () => unknown,
  expected: string | RegExp | Error,
): MaybePromise<void> =>
  assertRejects(fn, (error: unknown) => {
    expect(() => {
      throw error;
    }).toThrow(expected);
    return true;
  });
