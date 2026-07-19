import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStateSqlite } from "./state-adapter-variance.spec-helper.js";

const tablePrefix = "queuert_";
let idCounter = 0;

const it = extendWithVarianceStateSqlite(baseIt, {
  tablePrefix,
  generateId: () => `custom-${Date.now()}-${idCounter++}`,
});

it("index");

describe("SQLite State Adapter Variance - Custom ID Generator", () => {
  it("generates custom-prefixed job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createChains({
        txCtx,
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
      }),
    );
    expect(job.id.startsWith("custom-")).toBe(true);
    expect(job.chainId.startsWith("custom-")).toBe(true);
  });

  it("creates tables with correct prefix", ({ tableNames }) => {
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  stateAdapterConformanceTestSuite({ it });
});
