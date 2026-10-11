import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStateSqlite } from "./state-adapter-variance.spec-helper.js";

const tablePrefix = "jobs_";

const it = extendWithVarianceStateSqlite(baseIt, {
  tablePrefix,
  generateId: () => `job-${crypto.randomUUID()}`,
  validateId: (id) => id.startsWith("job-"),
  maxBlockersPerJob: 2,
  countCap: 3,
});

it("index");

describe("SQLite State Adapter Variance - All Custom Options", () => {
  it("creates tables with correct prefix", ({ tableNames }) => {
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  stateAdapterConformanceTestSuite({ it });
});
