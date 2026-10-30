import { describe, expect, it } from "vitest";

import { narrowToStatuses } from "./typeData.js";

const count = (value: number) => ({ count: value, hasMore: false });

describe("narrowToStatuses", () => {
  it("keeps only the given statuses and drops types with nothing in them", () => {
    const entries = [
      {
        typeName: "greet",
        counts: [
          { status: "running" as const, count: count(2) },
          { status: "completed" as const, count: count(1) },
        ],
      },
      {
        typeName: "count-step",
        counts: [
          { status: "running" as const, count: count(0) },
          { status: "completed" as const, count: count(4) },
        ],
      },
    ];

    expect(narrowToStatuses(entries, ["running"])).toEqual([
      { typeName: "greet", counts: [{ status: "running", count: count(2) }] },
    ]);
    expect(narrowToStatuses(entries, ["running", "completed"])).toEqual(entries);
  });

  it("keeps a type's live worker count", () => {
    const workers = { liveCount: 0, stranded: true };

    expect(
      narrowToStatuses(
        [{ typeName: "ship-order", counts: [{ status: "pending", count: count(3) }], workers }],
        ["pending"],
      ),
    ).toEqual([
      { typeName: "ship-order", counts: [{ status: "pending", count: count(3) }], workers },
    ]);
  });
});
