import { describe, expect, it } from "vitest";

import { formatCount, formatSum, sumCounts } from "./counts.js";

describe("counts", () => {
  it("formats a capped count with a trailing +", () => {
    expect(formatCount({ count: 10_000, hasMore: true })).toBe(`${(10_000).toLocaleString()}+`);
    expect(formatCount({ count: 12, hasMore: false })).toBe("12");
  });

  it("sums counts and marks the sum as a lower bound when any part is capped", () => {
    const exact = sumCounts([
      { count: 2, hasMore: false },
      { count: 3, hasMore: false },
    ]);
    const capped = sumCounts([
      { count: 10_000, hasMore: true },
      { count: 5, hasMore: false },
    ]);

    expect(exact).toEqual({ count: 5, hasMore: false });
    expect(formatSum(exact)).toBe("5");
    expect(capped).toEqual({ count: 10_005, hasMore: true });
    expect(formatSum(capped)).toBe(`≥${(10_005).toLocaleString()}`);
    expect(sumCounts([])).toEqual({ count: 0, hasMore: false });
  });
});
