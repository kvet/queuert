import { it as baseIt, describe, expect } from "vitest";

import { sql } from "./sql.js";
import { type TemplateApplier, createTemplateApplier } from "./template-applier.js";
import { createTemplateCache } from "./template-cache.js";

const it = baseIt.extend<{ applyTemplate: TemplateApplier }>({
  // oxlint-disable-next-line no-empty-pattern
  applyTemplate: async ({}, use) => {
    await use(createTemplateApplier({}));
  },
});

describe("createTemplateCache", () => {
  it("computes once per key and returns the cached result on later calls", ({ applyTemplate }) => {
    const cache = createTemplateCache();
    let calls = 0;
    const compute = () => {
      calls++;
      return applyTemplate(sql("SELECT 1", { id: "one" }));
    };

    const first = cache.getOrCompute("one", compute);
    const second = cache.getOrCompute("one", compute);

    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("computes separately for different keys", ({ applyTemplate }) => {
    const cache = createTemplateCache();

    const a = cache.getOrCompute("a", () => applyTemplate(sql("SELECT 'a'", { id: "a" })));
    const b = cache.getOrCompute("b", () => applyTemplate(sql("SELECT 'b'", { id: "b" })));

    expect(a).not.toBe(b);
    expect(a.sql).toBe("SELECT 'a'");
    expect(b.sql).toBe("SELECT 'b'");
  });
});
