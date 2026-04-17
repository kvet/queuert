import assert from "node:assert/strict";

import { sleep } from "../helpers/sleep.js";
import { SkipSignalError } from "./skip-signal-error.js";

/**
 * Minimal vitest/jest-compatible `expect` shim, backed by `node:assert/strict`.
 * Zero deps. Works in Node, Bun, Deno, or any runtime with node:assert.
 *
 * Intentionally scoped to matchers used by conformance test cases.
 */

export type Matchers<T> = {
  toBe: (expected: T) => void;
  toEqual: (expected: unknown) => void;
  toBeDefined: () => void;
  toBeUndefined: () => void;
  toBeNull: () => void;
  toBeGreaterThan: (expected: number) => void;
  toBeGreaterThanOrEqual: (expected: number) => void;
  toBeLessThan: (expected: number) => void;
  toBeLessThanOrEqual: (expected: number) => void;
  toBeInstanceOf: (expected: new (...args: any[]) => unknown) => void;
  toContain: (expected: unknown) => void;
  toHaveLength: (expected: number) => void;
  toThrow: (expected?: string | RegExp | (new (...args: any[]) => Error)) => void;
};

export type AsyncMatchers = {
  toThrow: (expected?: string | RegExp | (new (...args: any[]) => Error)) => Promise<void>;
};

export type ExpectResult<T> = Matchers<T> & {
  not: Matchers<T>;
  rejects: AsyncMatchers;
};

export type Expect = {
  <T>(actual: T): ExpectResult<T>;
  poll: <T>(
    fn: () => T | Promise<T>,
    options?: { timeout?: number; interval?: number },
  ) => {
    toBe: (expected: T) => Promise<void>;
    toEqual: (expected: T) => Promise<void>;
  };
  fail: (message: string) => never;
  /**
   * Mark the current case as skipped rather than passed or failed. Useful when
   * a case requires an optional capability (e.g., `poisonTransaction`) that
   * does not apply to the backend under test.
   */
  skip: (reason: string) => never;
};

const matchesExpected = (
  error: unknown,
  expected: string | RegExp | (new (...args: any[]) => Error) | undefined,
): boolean => {
  if (expected === undefined) return true;
  if (typeof expected === "string") {
    return error instanceof Error && error.message.includes(expected);
  }
  if (expected instanceof RegExp) {
    return error instanceof Error && expected.test(error.message);
  }
  return error instanceof expected;
};

const describeExpected = (
  expected: string | RegExp | (new (...args: any[]) => Error) | undefined,
): string => {
  if (expected === undefined) return "any error";
  if (typeof expected === "string") return `error containing "${expected}"`;
  if (expected instanceof RegExp) return `error matching ${expected.toString()}`;
  return `instance of ${expected.name}`;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/**
 * Vitest-compatible deep equality:
 *  - Object keys with `undefined` values are ignored (matches `toEqual`).
 *  - Dates compared by timestamp, RegExps by source/flags.
 *  - Class instances compared structurally (ignores prototype).
 */
const deepEqualLoose = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp && b instanceof RegExp)
    return a.source === b.source && a.flags === b.flags;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqualLoose(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).filter((k) => a[k] !== undefined);
    const bKeys = Object.keys(b).filter((k) => b[k] !== undefined);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqualLoose(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
};

const formatValue = (value: unknown): string => {
  try {
    return JSON.stringify(
      value,
      (_, v) => {
        if (v instanceof Date) return `Date(${v.toISOString()})`;
        if (v instanceof RegExp) return v.toString();
        if (typeof v === "bigint") return `${v}n`;
        if (typeof v === "undefined") return "<undefined>";
        return v;
      },
      2,
    );
  } catch {
    return String(value);
  }
};

const buildMatchers = <T>(actual: T, negated: boolean): Matchers<T> => {
  const check = (ok: boolean, message: string): void => {
    if (negated ? ok : !ok) {
      throw new assert.AssertionError({
        message: negated ? `expected NOT ${message}` : message,
        actual,
      });
    }
  };

  return {
    toBe: (expected) => {
      const ok = Object.is(actual, expected);
      check(ok, `expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
    },
    toEqual: (expected) => {
      const ok = deepEqualLoose(actual, expected);
      check(
        ok,
        `expected values to deep-equal\n  actual:   ${formatValue(actual)}\n  expected: ${formatValue(expected)}`,
      );
    },
    toBeDefined: () => {
      check(actual !== undefined, `expected value to be defined`);
    },
    toBeUndefined: () => {
      check(actual === undefined, `expected ${JSON.stringify(actual)} to be undefined`);
    },
    toBeNull: () => {
      check(actual === null, `expected ${JSON.stringify(actual)} to be null`);
    },
    toBeGreaterThan: (expected) => {
      check((actual as number) > expected, `expected ${String(actual)} > ${expected}`);
    },
    toBeGreaterThanOrEqual: (expected) => {
      check((actual as number) >= expected, `expected ${String(actual)} >= ${expected}`);
    },
    toBeLessThan: (expected) => {
      check((actual as number) < expected, `expected ${String(actual)} < ${expected}`);
    },
    toBeLessThanOrEqual: (expected) => {
      check((actual as number) <= expected, `expected ${String(actual)} <= ${expected}`);
    },
    toBeInstanceOf: (expected) => {
      check(actual instanceof expected, `expected value to be instance of ${expected.name}`);
    },
    toContain: (expected) => {
      if (typeof actual === "string") {
        check(
          actual.includes(expected as string),
          `expected string to contain ${String(expected)}`,
        );
      } else if (Array.isArray(actual)) {
        check(actual.includes(expected), `expected array to contain ${String(expected)}`);
      } else {
        throw new TypeError(`toContain expects string or array, got ${typeof actual}`);
      }
    },
    toHaveLength: (expected) => {
      const value = actual as { length?: number } | null | undefined;
      if (value == null || typeof value.length !== "number") {
        throw new TypeError(`toHaveLength expects a value with a numeric length`);
      }
      check(value.length === expected, `expected length ${value.length} to be ${expected}`);
    },
    toThrow: (expected) => {
      if (typeof actual !== "function") {
        throw new TypeError(`toThrow expects a function`);
      }
      let thrown: unknown;
      let didThrow = false;
      try {
        (actual as () => unknown)();
      } catch (err) {
        thrown = err;
        didThrow = true;
      }
      const ok = didThrow && matchesExpected(thrown, expected);
      check(ok, `expected function to throw ${describeExpected(expected)}`);
    },
  };
};

const buildRejects = (actualPromise: unknown): AsyncMatchers => {
  return {
    toThrow: async (expected) => {
      if (!(actualPromise instanceof Promise)) {
        throw new TypeError(`.rejects expects a Promise`);
      }
      let thrown: unknown;
      let didThrow = false;
      try {
        await actualPromise;
      } catch (err) {
        thrown = err;
        didThrow = true;
      }
      if (!didThrow) {
        throw new assert.AssertionError({
          message: `expected promise to reject with ${describeExpected(expected)}`,
        });
      }
      if (!matchesExpected(thrown, expected)) {
        throw new assert.AssertionError({
          message: `expected rejection to match ${describeExpected(expected)}, got: ${
            thrown instanceof Error ? thrown.message : String(thrown)
          }`,
        });
      }
    },
  };
};

export const expect: Expect = Object.assign(
  <T>(actual: T): ExpectResult<T> => ({
    ...buildMatchers(actual, false),
    not: buildMatchers(actual, true),
    rejects: buildRejects(actual),
  }),
  {
    poll: <T>(fn: () => T | Promise<T>, options: { timeout?: number; interval?: number } = {}) => {
      const timeout = options.timeout ?? 1000;
      const interval = options.interval ?? 50;
      const tryUntil = async (
        predicate: (value: T) => boolean,
        describe: string,
      ): Promise<void> => {
        const deadline = Date.now() + timeout;
        let last: T;
        while (Date.now() < deadline) {
          last = await fn();
          if (predicate(last)) return;
          await sleep(interval);
        }
        throw new assert.AssertionError({
          message: `poll timed out after ${timeout}ms: ${describe} (last value: ${JSON.stringify(last!)})`,
        });
      };
      return {
        toBe: async (expected: T) =>
          tryUntil((v) => Object.is(v, expected), `expected ${JSON.stringify(expected)}`),
        toEqual: async (expected: T) =>
          tryUntil(
            (v) => deepEqualLoose(v, expected),
            `expected deep-equal ${JSON.stringify(expected)}`,
          ),
      };
    },
    fail: (message: string): never => {
      throw new assert.AssertionError({ message });
    },
    skip: (reason: string): never => {
      throw new SkipSignalError(reason);
    },
  },
);
