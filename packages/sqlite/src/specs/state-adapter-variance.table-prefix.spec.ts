import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import {
  UUID_PATTERN,
  extendWithVarianceStateSqlite,
} from "./state-adapter-variance.spec-helper.js";

const tablePrefix = "myapp_queue_";

const it = extendWithVarianceStateSqlite(baseIt, { tablePrefix });

it("index");

describe("SQLite State Adapter Variance - Custom Table Prefix", () => {
  it("generates UUID job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createChains({
        txCtx,
        jobs: [{ typeName: "t", chainTypeName: "t", input: null }],
      }),
    );
    expect(UUID_PATTERN.test(job.id)).toBe(true);
    expect(UUID_PATTERN.test(job.chainId)).toBe(true);
  });

  it("creates tables with correct prefix", ({ tableNames }) => {
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  stateAdapterConformanceTestSuite({ it });
});
