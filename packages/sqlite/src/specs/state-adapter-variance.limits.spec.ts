import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { stateAdapterCountCapGroups } from "queuert/conformance-internal";
import { it as baseIt, describe, expect } from "vitest";

import { sqliteStateAdapterConformanceGroups } from "../conformance/state-provider-conformance.ts";
import {
  varianceConformance,
  varianceDb,
  varianceTableNames,
} from "./state-adapter-variance.spec-helper.ts";

const tablePrefix = "limits_";

const options = {
  tablePrefix,
  maxBlockersPerJob: 2,
  countCap: 3,
};

baseIt("index");

for (const mode of ["async", "sync"] as const) {
  const it = baseIt
    .extend("db", { scope: "file" }, varianceDb)
    .extend("conformance", { scope: "file" }, varianceConformance(options, mode))
    .extend("tableNames", { scope: "file" }, varianceTableNames(options));

  describe(`SQLite State Adapter Variance - Limits (${mode})`, () => {
    it("creates tables with correct prefix", ({ tableNames }) => {
      expect(tableNames).toContain(`${tablePrefix}job`);
      expect(tableNames).toContain(`${tablePrefix}job_blocker`);
      expect(tableNames).toContain(`${tablePrefix}migration`);
    });

    conformanceTestSuite({
      it,
      mode,
      groups: [...sqliteStateAdapterConformanceGroups, ...stateAdapterCountCapGroups],
    });
  });
}
