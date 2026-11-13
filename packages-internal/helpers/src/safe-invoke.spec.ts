import { describe, expect, test, vi } from "vitest";

import { safeInvoke } from "./safe-invoke.ts";

describe("safeInvoke", () => {
  test("calls fn and swallows what it throws", () => {
    const fn = vi.fn(() => {
      throw new Error("ignored");
    });
    expect(() => {
      safeInvoke(fn);
    }).not.toThrow();
    expect(fn).toHaveBeenCalledOnce();
  });
});
