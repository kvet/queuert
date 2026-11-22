import { describe, expect, it } from "vitest";

import { loadedAnnouncement, loadedItems, shouldLoadNextPage } from "./pages.ts";

describe("loadedItems", () => {
  it("joins the loaded pages in order", () => {
    expect(loadedItems([{ items: [{ id: "a" }] }, { items: [{ id: "b" }, { id: "c" }] }])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
  });

  it("skips items that moved across the cursor and are already loaded", () => {
    const first = { items: [{ id: "a" }, { id: "b" }] };

    const result = loadedItems([first, { items: [{ id: "b" }, { id: "c" }] }]);

    expect(result.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result[1]).toBe(first.items[1]);
  });
});

describe("loadedAnnouncement", () => {
  it("announces the size of the page loaded after the first", () => {
    expect(loadedAnnouncement([{ items: [1, 2] }])).toBe("");
    expect(loadedAnnouncement([{ items: [1, 2] }, { items: [3] }])).toBe("Loaded 1 more");
    expect(loadedAnnouncement([{ items: [1] }, { items: [2, 3] }], "jobs")).toBe(
      "Loaded 2 more jobs",
    );
  });
});

describe("shouldLoadNextPage", () => {
  const idle = { hasNextPage: true, isFetching: false, isFetchNextPageError: false };

  it("loads only when a next page exists and nothing is in flight or failed", () => {
    expect(shouldLoadNextPage(idle)).toBe(true);
    expect(shouldLoadNextPage({ ...idle, hasNextPage: false })).toBe(false);
    expect(shouldLoadNextPage({ ...idle, isFetching: true })).toBe(false);
    expect(shouldLoadNextPage({ ...idle, isFetchNextPageError: true })).toBe(false);
  });
});
