import { describe, expect, it } from "vitest";

import { MAX_IDS, parseIdList, shortId } from "./ids.js";

describe("shortId", () => {
  it("keeps IDs of up to 16 characters unchanged", () => {
    expect(shortId("job-42")).toBe("job-42");
    expect(shortId("abcdefghijklmnop")).toBe("abcdefghijklmnop");
  });

  it("shortens longer IDs to first 8 + … + last 4", () => {
    expect(shortId("0193f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f")).toBe("0193f1c2…4e5f");
  });
});

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
