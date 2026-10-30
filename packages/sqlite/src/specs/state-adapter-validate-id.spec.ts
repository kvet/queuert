import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStateSqlite } from "./state-adapter-variance.spec-helper.js";

const tablePrefix = "queuert_";

const it = extendWithVarianceStateSqlite(baseIt, {
  tablePrefix,
  generateId: () => `ok-${crypto.randomUUID()}`,
  validateId: (id) => id.startsWith("ok-"),
  generateWorkerId: () => `worker-${crypto.randomUUID()}`,
  validateWorkerId: (id) => id.startsWith("worker-"),
});

it("index");

describe("SQLite State Adapter Variance - With validateId", () => {
  it("creates tables with correct prefix", ({ tableNames }) => {
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
    expect(tableNames).toContain(`${tablePrefix}worker`);
  });

  stateAdapterConformanceTestSuite({ it });
});
