import { extendWithPostgres } from "@queuert/testcontainers";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStatePg } from "./state-adapter-variance.spec-helper.js";

const schema = "queuert_all_custom_options";
const tablePrefix = "jobs_";

const it = extendWithVarianceStatePg(extendWithPostgres(baseIt, import.meta.url), {
  schema,
  tablePrefix,
  jobIdType: "text",
  workerIdType: "varchar",
  generateJobId: () => `job-${crypto.randomUUID()}`,
  validateJobId: (id) => id.startsWith("job-"),
  generateWorkerId: () => `worker-${crypto.randomUUID()}`,
  validateWorkerId: (id) => id.startsWith("worker-"),
  maxBlockersPerJob: 2,
  countCap: 3,
});

it("index");

describe("PostgreSQL State Adapter Variance - All Custom Options", () => {
  it("creates tables with correct prefix", ({ tableNames }) => {
    expect(tableNames).toContain(`${tablePrefix}job`);
    expect(tableNames).toContain(`${tablePrefix}job_blocker`);
    expect(tableNames).toContain(`${tablePrefix}worker`);
    expect(tableNames).toContain(`${tablePrefix}migration`);
  });

  it("stores worker IDs in columns of the configured type", async ({ pool, stateAdapter: _ }) => {
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

  stateAdapterConformanceTestSuite({ it });
});
