import { describe, expect, it } from "vitest";

import { appendPage } from "./pages.js";

describe("appendPage", () => {
  it("appends the next page", () => {
    expect(appendPage([{ id: "a" }], [{ id: "b" }, { id: "c" }])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
  });

  it("skips items that moved across the cursor and are already loaded", () => {
    const loaded = [{ id: "a" }, { id: "b" }];

    const result = appendPage(loaded, [{ id: "b" }, { id: "c" }]);

    expect(result.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result[1]).toBe(loaded[1]);
  });
});
