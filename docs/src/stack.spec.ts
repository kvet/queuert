import { describe, expect, it } from "vitest";

import {
  allocationGroups,
  completionGroups,
  cpuGroups,
  creationGroups,
  memoryGroups,
} from "./data/benchmarks.ts";
import { backends, parseStack, shownInStack, stackScript, stackStyle } from "./stack.ts";

const runStackScript = (stored: string | null) => {
  const dataset: Record<string, string> = {};
  const localStorage = { getItem: () => stored };
  new Function("localStorage", "document", stackScript)(localStorage, {
    documentElement: { dataset },
  });
  return dataset.stack;
};

describe("parseStack", () => {
  it("keeps known backends in backends order", () => {
    expect(parseStack(JSON.stringify(["redis", "postgres"]))).toEqual(["postgres", "redis"]);
  });

  it("drops unknown entries and reads malformed or missing values as none", () => {
    expect(parseStack(JSON.stringify(["postgres", "oracle"]))).toEqual(["postgres"]);
    expect(parseStack("{")).toEqual([]);
    expect(parseStack(JSON.stringify({ postgres: true }))).toEqual([]);
    expect(parseStack(null)).toEqual([]);
  });
});

describe("shownInStack", () => {
  it("shows everything until the reader picks, and untagged rows always", () => {
    expect(shownInStack("mysql", [])).toBe(true);
    expect(shownInStack(undefined, ["postgres"])).toBe(true);
    expect(shownInStack("postgres", ["postgres"])).toBe(true);
    expect(shownInStack("mysql", ["postgres"])).toBe(false);
  });
});

describe("stackScript", () => {
  it("marks <html> with the saved backends before the first paint", () => {
    expect(runStackScript(JSON.stringify(["postgres", "sqlite"]))).toBe("postgres sqlite");
  });

  it("leaves <html> unmarked when nothing is saved or the value is malformed", () => {
    expect(runStackScript(null)).toBeUndefined();
    expect(runStackScript(JSON.stringify([]))).toBeUndefined();
    expect(runStackScript("{")).toBeUndefined();
  });
});

describe("stackStyle", () => {
  it("has a hiding rule for every backend", () => {
    for (const backend of backends) {
      expect(stackStyle).toContain(
        `:root[data-stack]:not([data-stack~="${backend.id}"]) [data-backend="${backend.id}"]`,
      );
    }
  });
});

describe("benchmark rows", () => {
  it("tags every adapter row with its backend", () => {
    const groups = [
      ...creationGroups,
      ...completionGroups,
      ...memoryGroups,
      ...cpuGroups,
      ...allocationGroups,
    ];
    const untagged = groups.flatMap((group) =>
      group.rows.filter((row) => !("backend" in row)).map((row) => row.label),
    );
    expect([...new Set(untagged)]).toEqual(["dashboard", "otel"]);
  });
});
