import { extendWithPostgres } from "@queuert/testcontainers";
import {
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
} from "queuert/conformance-internal";
import { conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStatePg } from "./state-adapter-variance.spec-helper.ts";

const it = extendWithVarianceStatePg(extendWithPostgres(baseIt, import.meta.url), {
  schema: "queuert",
  tablePrefix: "myapp_",
});

it("index");

describe("PostgreSQL State Adapter Variance - Custom Table Prefix", () => {
  it("creates tables in the configured schema", ({ tableNames }) => {
    expect(tableNames).toContain("myapp_job");
    expect(tableNames).toContain("myapp_job_blocker");
    expect(tableNames).toContain("myapp_migration");
  });

  conformanceTestSuite({
    it,
    groups: [...stateAdapterBaseGroups, ...stateAdapterConcurrentTransactionGroups],
  });
});
