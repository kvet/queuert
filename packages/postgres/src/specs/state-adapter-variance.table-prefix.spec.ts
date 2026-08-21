import { extendWithPostgres } from "@queuert/testcontainers";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { UUID_PATTERN, extendWithVarianceStatePg } from "./state-adapter-variance.spec-helper.js";

const schema = "queuert";
const tablePrefix = "myapp_";

const it = extendWithVarianceStatePg(extendWithPostgres(baseIt, import.meta.url), {
  schema,
  tablePrefix,
});

it("index");

describe("PostgreSQL State Adapter Variance - Custom Table Prefix", () => {
  it("generates UUID job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createChains({
        txCtx,
        jobs: [{ typeName: "t", input: null }],
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
