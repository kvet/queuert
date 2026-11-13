import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { it as baseIt, describe, expect } from "vitest";

import { sqliteStateAdapterConformanceGroups } from "../conformance/state-provider-conformance.ts";
import {
  varianceConformance,
  varianceDb,
  varianceTableNames,
} from "./state-adapter-variance.spec-helper.ts";

const tablePrefix = "queuert_";

const options = {
  tablePrefix,
  generateJobId: () => `ok-${crypto.randomUUID()}`,
  validateJobId: (id: string) => id.startsWith("ok-"),
  generateWorkerId: () => `worker-${crypto.randomUUID()}`,
  validateWorkerId: (id: string) => id.startsWith("worker-"),
};

baseIt("index");

for (const mode of ["async", "sync"] as const) {
  const it = baseIt
    .extend("db", { scope: "file" }, varianceDb)
    .extend("conformance", { scope: "file" }, varianceConformance(options, mode))
    .extend("tableNames", { scope: "file" }, varianceTableNames(options));

  describe(`SQLite State Adapter Variance - With validateJobId (${mode})`, () => {
    it("creates tables with correct prefix", ({ tableNames }) => {
      expect(tableNames).toContain(`${tablePrefix}job`);
      expect(tableNames).toContain(`${tablePrefix}job_blocker`);
      expect(tableNames).toContain(`${tablePrefix}migration`);
      expect(tableNames).toContain(`${tablePrefix}worker`);
    });

    conformanceTestSuite({
      it,
      mode,
      groups: sqliteStateAdapterConformanceGroups,
    });
  });
}
