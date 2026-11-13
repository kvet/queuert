import { describe, expect, it } from "vitest";

import { instantiationGroups, seriesOf, typeGroups } from "./benchmarks.ts";

describe("instantiationGroups", () => {
  it("notes each scenario's type count and its scaling against the one-type baseline", () => {
    const meta = Object.fromEntries(
      instantiationGroups[0].rows.map((row) => [row.label, row.meta]),
    );
    expect(meta["Linear: 1 type"]).toBe("1 type · 1.0x baseline");
    expect(meta["Linear: 100 types"]).toBe("100 types · 3.7x baseline");
    expect(meta["Merge: 50 x 50"]).toBe("2,500 types · 70.6x baseline");
  });
});

describe("seriesOf", () => {
  it("keeps one series of every row", () => {
    const ts7 = seriesOf(typeGroups, 1)[0].rows.find((row) => row.label === "Linear: 100 types");
    expect(ts7?.values).toEqual([158]);
  });
});
