import { describe, expect, it } from "vitest";

import * as benchmarks from "./benchmarks.ts";
import { instantiationGroups, seriesOf, typeGroups } from "./benchmarks.ts";

describe("benchmark groups", () => {
  it("read a number for every row and series from the benchmarks' results.md", () => {
    const groups = Object.entries(benchmarks).filter(([name]) => name.endsWith("Groups"));
    expect(groups.length).toBeGreaterThan(0);
    for (const [, value] of groups) {
      for (const group of value as { rows: { values: number[] }[] }[]) {
        expect(group.rows.length).toBeGreaterThan(0);
        for (const row of group.rows) {
          for (const cell of row.values) expect(Number.isFinite(cell)).toBe(true);
        }
      }
    }
  });
});

describe("instantiationGroups", () => {
  it("notes each scenario's type count and its scaling against the one-type baseline", () => {
    const [baseline, ...rows] = instantiationGroups[0].rows;
    expect(baseline.label).toBe("Linear: 1 type");
    expect(baseline.meta).toBe("1 type · 1.0x baseline");
    const merge = rows.find((row) => row.label === "Merge: 50 x 50")!;
    expect(merge.meta).toBe(
      `2,500 types · ${(merge.values[0] / baseline.values[0]).toFixed(1)}x baseline`,
    );
  });
});

describe("seriesOf", () => {
  it("keeps one series of every row", () => {
    const linear = typeGroups[0].rows.find((row) => row.label === "Linear: 100 types")!;
    const ts7 = seriesOf(typeGroups, 1)[0].rows.find((row) => row.label === "Linear: 100 types");
    expect(ts7?.values).toEqual([linear.values[1]]);
  });
});
