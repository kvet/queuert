import { extendWithPostgres } from "@queuert/testcontainers";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStatePg } from "./state-adapter-variance.spec-helper.js";

const it = extendWithVarianceStatePg(extendWithPostgres(baseIt, import.meta.url), {
  schema: "queuert_text_id",
  idType: "text",
});

it("index");

describe("PostgreSQL State Adapter Variance - Text ID Type", () => {
  it("generates text job IDs", async ({ stateAdapter }) => {
    const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createChains({
        txCtx,
        jobs: [{ typeName: "t", input: null }],
      }),
    );
    expect(typeof job.id).toBe("string");
    expect(job.id.length > 0).toBe(true);
  });

  it("creates tables in correct schema", ({ tableNames }) => {
    expect(tableNames).toContain("queuert_job");
    expect(tableNames).toContain("queuert_job_blocker");
    expect(tableNames).toContain("queuert_migration");
  });

  stateAdapterConformanceTestSuite({ it });
});
