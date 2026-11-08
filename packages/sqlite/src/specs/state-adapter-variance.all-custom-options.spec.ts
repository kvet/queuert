import { stateAdapterBaseGroups } from "queuert/conformance-internal";
import { conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStateSqlite } from "./state-adapter-variance.spec-helper.ts";

const tablePrefix = "jobs_";

const it = extendWithVarianceStateSqlite(baseIt, {
  tablePrefix,
  workerIdType: "VARCHAR",
  generateJobId: () => `job-${crypto.randomUUID()}`,
  validateJobId: (id) => id.startsWith("job-"),
  generateWorkerId: () => `worker-${crypto.randomUUID()}`,
  validateWorkerId: (id) => id.startsWith("worker-"),
  maxBlockersPerJob: 2,
  countCap: 3,
});

it("index");

describe("SQLite State Adapter Variance - All Custom Options", () => {
  it("creates tables with correct prefix", ({ tableNames }) => {
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}worker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  conformanceTestSuite({ it, groups: stateAdapterBaseGroups });
});
