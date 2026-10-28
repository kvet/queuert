import { describe, expect, it } from "vitest";

import { MAX_IDS, parseIdList } from "./ids.js";

describe("parseIdList", () => {
  it("splits on commas, whitespace and newlines, trimming and deduplicating", () => {
    expect(parseIdList(" a, b\nc  a,,\tb ")).toEqual({ ids: ["a", "b", "c"], overLimit: false });
  });

  it(`caps the list at ${MAX_IDS} IDs`, () => {
    const text = Array.from({ length: MAX_IDS + 1 }, (_, i) => `id-${i}`).join(",");

    const result = parseIdList(text);

    expect(result.ids).toHaveLength(MAX_IDS);
    expect(result.overLimit).toBe(true);
  });
});
