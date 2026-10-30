import { extendWithPostgres } from "@queuert/testcontainers";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStatePg } from "./state-adapter-variance.spec-helper.js";

const it = extendWithVarianceStatePg(extendWithPostgres(baseIt, import.meta.url), {
  schema: "queuert_validateid",
  idType: "text",
  generateId: () => `ok-${crypto.randomUUID()}`,
  validateId: (id) => id.startsWith("ok-"),
  generateWorkerId: () => `worker-${crypto.randomUUID()}`,
  validateWorkerId: (id) => id.startsWith("worker-"),
});

it("index");

describe("PostgreSQL State Adapter Variance - With validateId", () => {
  it("creates tables in the configured schema", ({ tableNames }) => {
    expect(tableNames).toContain("queuert_job");
    expect(tableNames).toContain("queuert_job_blocker");
    expect(tableNames).toContain("queuert_migration");
    expect(tableNames).toContain("queuert_worker");
  });

  stateAdapterConformanceTestSuite({ it });
});
