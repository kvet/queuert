import { describe, expect, test } from "vitest";

import { assertRejects } from "./assert-rejects.ts";

describe("assertRejects", () => {
  test("passes when the function throws synchronously, matching the error when given", () => {
    const fail = () => {
      throw new Error("rolled back");
    };
    expect(assertRejects(fail)).toBeUndefined();
    expect(assertRejects(fail, /rolled back/)).toBeUndefined();
    expect(() => {
      void assertRejects(fail, /committed/);
    }).toThrow();
  });

  test("passes when the function returns a rejecting promise, matching the error when given", async () => {
    await assertRejects(async () => Promise.reject(new Error("rolled back")), /rolled back/);
    await expect(
      assertRejects(async () => Promise.reject(new Error("rolled back")), /committed/),
    ).rejects.toThrow();
  });

  test("fails when the function returns", () => {
    expect(() => {
      void assertRejects(() => 1);
    }).toThrow("Expected the function to throw, but it returned");
  });

  test("fails when the function returns a promise that resolves", async () => {
    await expect(assertRejects(async () => 1)).rejects.toThrow(
      "Expected the function to reject, but it resolved",
    );
  });
});
