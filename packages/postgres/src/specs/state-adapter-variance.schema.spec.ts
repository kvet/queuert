import { extendWithPostgres } from "@queuert/testcontainers";
import {
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterSchemaFenceConcurrentTransactionGroups,
  stateAdapterSchemaFenceGroups,
} from "queuert/conformance-internal";
import { conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStatePg } from "./state-adapter-variance.spec-helper.ts";

const it = extendWithVarianceStatePg(extendWithPostgres(baseIt, import.meta.url), {
  schema: "myapp_jobs",
});

it("index");

describe("PostgreSQL State Adapter Variance - Custom Schema", () => {
  it("creates tables in the configured schema", ({ tableNames }) => {
    expect(tableNames).toContain("queuert_job");
    expect(tableNames).toContain("queuert_job_blocker");
    expect(tableNames).toContain("queuert_migration");
  });

  conformanceTestSuite({
    it,
    groups: [
      ...stateAdapterBaseGroups,
      ...stateAdapterSchemaFenceGroups,
      ...stateAdapterConcurrentTransactionGroups,
      ...stateAdapterSchemaFenceConcurrentTransactionGroups,
    ],
  });
});
