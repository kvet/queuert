import { extendWithPostgres } from "@queuert/testcontainers";
import {
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
} from "queuert/conformance-internal";
import { conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStatePg } from "./state-adapter-variance.spec-helper.ts";

const it = extendWithVarianceStatePg(extendWithPostgres(baseIt, import.meta.url), {
  schema: "queuert_validateid",
  jobIdType: "text",
  workerIdType: "text",
  generateJobId: () => `ok-${crypto.randomUUID()}`,
  validateJobId: (id) => id.startsWith("ok-"),
  generateWorkerId: () => `worker-${crypto.randomUUID()}`,
  validateWorkerId: (id) => id.startsWith("worker-"),
});

it("index");

describe("PostgreSQL State Adapter Variance - With validateJobId", () => {
  it("creates tables in the configured schema", ({ tableNames }) => {
    expect(tableNames).toContain("queuert_job");
    expect(tableNames).toContain("queuert_job_blocker");
    expect(tableNames).toContain("queuert_migration");
    expect(tableNames).toContain("queuert_worker");
  });

  conformanceTestSuite({
    it,
    groups: [...stateAdapterBaseGroups, ...stateAdapterConcurrentTransactionGroups],
  });
});
