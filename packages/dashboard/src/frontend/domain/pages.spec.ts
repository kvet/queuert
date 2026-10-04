import { describe, expect, it } from "vitest";

import { appendPage, mergeRefreshedPage, replaceFirstPage, sameIds } from "./pages.js";

describe("sameIds", () => {
  it("compares IDs in order", () => {
    expect(sameIds([{ id: "a" }, { id: "b" }], [{ id: "a" }, { id: "b" }])).toBe(true);
    expect(sameIds([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }])).toBe(false);
    expect(sameIds([{ id: "a" }], [{ id: "a" }, { id: "b" }])).toBe(false);
  });
});

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

describe("mergeRefreshedPage", () => {
  it("replaces an empty list", () => {
    expect(mergeRefreshedPage([], [{ id: "a" }])).toEqual({ kind: "replace" });
  });

  it("updates the top rows in place when their IDs are unchanged", () => {
    const loaded = [
      { id: "a", v: 1 },
      { id: "b", v: 1 },
      { id: "c", v: 1 },
    ];

    expect(
      mergeRefreshedPage(loaded, [
        { id: "a", v: 2 },
        { id: "b", v: 2 },
      ]),
    ).toEqual({
      kind: "update",
      items: [
        { id: "a", v: 2 },
        { id: "b", v: 2 },
        { id: "c", v: 1 },
      ],
    });
  });

  it("holds back a page whose IDs changed", () => {
    expect(mergeRefreshedPage([{ id: "a" }, { id: "b" }], [{ id: "x" }, { id: "a" }])).toEqual({
      kind: "fresh",
    });
  });

  it("holds back an empty page over a loaded list", () => {
    expect(mergeRefreshedPage([{ id: "a" }], [])).toEqual({ kind: "fresh" });
  });
});

describe("replaceFirstPage", () => {
  it("swaps the first page and keeps later pages", () => {
    const loaded = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

    const result = replaceFirstPage(loaded, 2, [{ id: "x" }, { id: "a" }]);

    expect(result.map((item) => item.id)).toEqual(["x", "a", "c", "d"]);
  });

  it("drops later items that moved onto the first page", () => {
    const loaded = [{ id: "a" }, { id: "b" }, { id: "c" }];

    const result = replaceFirstPage(loaded, 2, [{ id: "c" }, { id: "a" }]);

    expect(result.map((item) => item.id)).toEqual(["c", "a"]);
  });
});
