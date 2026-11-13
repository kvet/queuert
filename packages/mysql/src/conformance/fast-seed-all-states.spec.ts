import { acquireMysql } from "@queuert/testcontainers";
import { type RowDataPacket, createPool } from "mysql2/promise";
import { seedAllStates } from "queuert/conformance-internal";
import { describe, expect, it } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  type Mysql2PoolContext,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";
import { fastSeedAllStates } from "./fast-seed-all-states.ts";

const jobQuery = `
  SELECT
    type_name, chain_index,
    CAST(input AS CHAR) AS input, CAST(output AS CHAR) AS output,
    status, chain_status, attempt,
    attempt_by, completed_by,
    CAST(last_attempt_error AS CHAR) AS last_attempt_error,
    chain_deduplication_key,
    chain_trace_context, trace_context,
    continued_to_id IS NOT NULL AS has_continuation,
    chain_completed_at IS NOT NULL AS has_chain_completion,
    created_at <= scheduled_at AS scheduled_after_creation,
    attempt_at IS NOT NULL AS has_attempt_at,
    completed_at IS NOT NULL AS has_completed_at,
    last_attempt_at IS NOT NULL AS has_last_attempt_at
  FROM queuert_job
  ORDER BY type_name, chain_index, CAST(JSON_EXTRACT(input, '$.index') AS SIGNED), CAST(JSON_EXTRACT(input, '$.n') AS SIGNED)
`;

const workerQuery = `
  SELECT id, CAST(type_names AS CHAR) AS type_names, concurrency, lease_until > UTC_TIMESTAMP(6) AS live
  FROM queuert_worker
  ORDER BY id
`;

const blockerQuery = `
  SELECT j.type_name AS job_type_name, bj.type_name AS blocker_type_name, b.\`index\` AS blocker_index
  FROM queuert_job_blocker b
  JOIN queuert_job j ON j.id = b.job_id
  JOIN queuert_job bj ON bj.id = b.blocked_by_chain_id
  ORDER BY j.type_name, bj.type_name, b.\`index\`
`;

describe.for([
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
])("$image fast seed", ({ image, dialect }) => {
  it("produces the same data as seedAllStates", { timeout: 300_000 }, async () => {
    const { connectionOptions } = await acquireMysql(image, `${import.meta.url}-${dialect}`);
    const pool = createPool({ ...connectionOptions, connectionLimit: 10 });
    try {
      const stateProvider = createMysql2PoolProvider({ pool });
      const stateAdapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
        stateProvider,
        dialect,
      });
      await stateAdapter.migrateToLatest();
      const snapshot = async () => ({
        jobs: (await pool.query<RowDataPacket[]>(jobQuery))[0],
        blockers: (await pool.query<RowDataPacket[]>(blockerQuery))[0],
        workers: (await pool.query<RowDataPacket[]>(workerQuery))[0],
      });
      const reset = async () => {
        await pool.query("DELETE FROM queuert_job_blocker");
        await pool.query("DELETE FROM queuert_job");
        await pool.query("DELETE FROM queuert_worker");
      };

      for (const scale of [1, 2]) {
        await reset();
        await seedAllStates(stateAdapter, { scale });
        const expected = await snapshot();
        await reset();
        await fastSeedAllStates(stateProvider, { scale });

        expect(await snapshot(), `scale=${scale}`).toEqual(expected);
      }
    } finally {
      await pool.end();
    }
  });
});
