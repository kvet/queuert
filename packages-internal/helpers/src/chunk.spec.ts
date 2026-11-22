import { describe, expect, test } from "vitest";

import { chunk } from "./chunk.ts";

describe("chunk", () => {
  test("splits items into chunks of size, every chunk full but the last", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  test("returns no chunks for no items", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});
