import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { it as baseIt, describe, expect } from "vitest";

import { pgStateAdapterConformanceGroups } from "../conformance/state-provider-conformance.ts";
import {
  varianceConformance,
  variancePool,
  varianceTableNames,
} from "./state-adapter-variance.spec-helper.ts";

const schema = "queuert_all_custom_options";
const tablePrefix = "jobs_";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const options = {
  schema,
  tablePrefix,
  jobIdType: "text",
  workerIdType: "varchar",
  generateJobId: () => `job-${crypto.randomUUID()}`,
  validateJobId: (id: string) => id.startsWith("job-"),
  generateWorkerId: () => `worker-${crypto.randomUUID()}`,
  validateWorkerId: (id: string) => id.startsWith("worker-"),
  maxBlockersPerJob: 2,
  countCap: 3,
};

const it = baseIt
  .extend("pool", { scope: "file" }, variancePool(pg.connectionString))
  .extend("conformance", { scope: "file" }, varianceConformance(options))
  .extend("tableNames", { scope: "file" }, varianceTableNames(options));

baseIt("index");

describe("PostgreSQL State Adapter Variance - All Custom Options", () => {
  it("creates tables with correct prefix", ({ tableNames }) => {
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}worker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  it("stores worker IDs in columns of the configured type", async ({ pool, conformance: _ }) => {
    const { rows } = await pool.query<{ column: string; udt_name: string }>(
      `SELECT table_name || '.' || column_name AS column, udt_name
       FROM information_schema.columns
       WHERE table_schema = $1
         AND (table_name, column_name) IN (($2 || 'worker', 'id'), ($2 || 'job', 'attempt_by'), ($2 || 'job', 'completed_by'))
       ORDER BY 1`,
      [schema, tablePrefix],
    );
    expect(rows).toEqual([
      { column: `${tablePrefix}job.attempt_by`, udt_name: "varchar" },
      { column: `${tablePrefix}job.completed_by`, udt_name: "varchar" },
      { column: `${tablePrefix}worker.id`, udt_name: "varchar" },
    ]);
  });

  conformanceTestSuite({ mode: "async", it, groups: pgStateAdapterConformanceGroups });
});
