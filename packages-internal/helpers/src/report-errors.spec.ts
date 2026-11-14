import { describe, expect, test, vi } from "vitest";

import { reportErrors } from "./report-errors.ts";

describe("reportErrors", () => {
  test("passes a resolved value through without reporting", async () => {
    const onError = vi.fn();
    const wrapped = reportErrors(async (value: number) => value * 2, onError, { sync: false });

    await expect(wrapped(2)).resolves.toBe(4);
    expect(onError).not.toHaveBeenCalled();
  });

  test("reports a rejection once and rejects with its error", async () => {
    const error = new Error("down");
    const onError = vi.fn();
    const wrapped = reportErrors(async () => Promise.reject(error), onError, { sync: false });

    await expect(wrapped()).rejects.toBe(error);
    expect(onError.mock.calls).toEqual([[error]]);
  });

  test("reports a synchronous throw once and rejects with it", async () => {
    const error = new Error("down");
    const onError = vi.fn();
    const wrapped = reportErrors(
      (): Promise<void> => {
        throw error;
      },
      onError,
      { sync: false },
    );

    await expect(wrapped()).rejects.toBe(error);
    expect(onError.mock.calls).toEqual([[error]]);
  });

  test("returns a plain value without reporting with sync", () => {
    const onError = vi.fn();
    const wrapped = reportErrors((value: number) => value * 2, onError, { sync: true });

    expect(wrapped(2)).toBe(4);
    expect(onError).not.toHaveBeenCalled();
  });

  test("reports a synchronous throw once and rethrows it with sync", () => {
    const error = new Error("down");
    const onError = vi.fn();
    const wrapped = reportErrors(
      () => {
        throw error;
      },
      onError,
      { sync: true },
    );

    expect(() => wrapped()).toThrow(error);
    expect(onError.mock.calls).toEqual([[error]]);
  });
});
