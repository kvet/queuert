import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { stateAdapterCountCapGroups } from "queuert/conformance-internal";
import { it as baseIt, describe, expect } from "vitest";

import { pgStateAdapterConformanceGroups } from "../conformance/state-provider-conformance.ts";
import {
  varianceConformance,
  variancePool,
  varianceTableNames,
} from "./state-adapter-variance.spec-helper.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const options = {
  schema: "queuert_limits",
  maxBlockersPerJob: 2,
  countCap: 3,
};

const it = baseIt
  .extend("pool", { scope: "file" }, variancePool(pg.connectionString))
  .extend("conformance", { scope: "file" }, varianceConformance(options))
  .extend("tableNames", { scope: "file" }, varianceTableNames(options));

baseIt("index");

describe("PostgreSQL State Adapter Variance - Limits", () => {
  it("creates tables in the configured schema", ({ tableNames }) => {
    expect(tableNames).toContain("queuert_job");
    expect(tableNames).toContain("queuert_job_blocker");
    expect(tableNames).toContain("queuert_migration");
  });

  conformanceTestSuite({
    mode: "async",
    it,
    groups: [...pgStateAdapterConformanceGroups, ...stateAdapterCountCapGroups],
  });
});
