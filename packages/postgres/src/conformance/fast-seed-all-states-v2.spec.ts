import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { extendWithResourceLeakDetection, seedAllStatesV2 } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";
import { fastSeedAllStatesV2 } from "./fast-seed-all-states-v2.js";

const jobQuery = `
  SELECT
    type_name, chain_type_name, chain_index,
    input, output,
    blocked, attempt,
    attempt_by, completed_by,
    last_attempt_error,
    deduplication_key,
    chain_trace_context, trace_context,
    continued_to_id IS NOT NULL AS has_continuation,
    created_at, scheduled_at, attempt_at, attempt_until, completed_at, last_attempt_at
  FROM public.queuert_job
  ORDER BY type_name, chain_index, (input->>'index')::int NULLS LAST, (input->>'n')::int NULLS LAST
`;

const blockerQuery = `
  SELECT
    j.type_name AS job_type_name,
    bj.type_name AS blocker_type_name,
    b."index" AS blocker_index
  FROM public.queuert_job_blocker b
  JOIN public.queuert_job j ON j.id = b.job_id
  JOIN public.queuert_job bj ON bj.id = b.blocked_by_chain_id
  ORDER BY j.type_name, bj.type_name, b."index"
`;

type TimestampRow = {
  type_name: string;
  chain_index: number;
  input_index: number | null;
  created_at: Date;
  scheduled_at: Date;
  attempt_at: Date | null;
  attempt_until: Date | null;
  completed_at: Date | null;
  last_attempt_at: Date | null;
};

const assertTemporalRelationships = (rows: TimestampRow[], label: string) => {
  for (const row of rows) {
    const ctx = `${label} [${row.type_name} idx=${row.input_index}]`;

    if (row.scheduled_at) {
      expect(row.scheduled_at >= row.created_at, `${ctx}: scheduled_at >= created_at`).toBe(true);
    }
    if (row.attempt_at) {
      expect(row.attempt_at >= row.created_at, `${ctx}: attempt_at >= created_at`).toBe(true);
    }
    if (row.attempt_until && row.attempt_at) {
      expect(row.attempt_until > row.attempt_at, `${ctx}: attempt_until > attempt_at`).toBe(true);
    }
    if (row.completed_at) {
      expect(row.completed_at >= row.created_at, `${ctx}: completed_at >= created_at`).toBe(true);
    }
    if (row.last_attempt_at) {
      expect(row.last_attempt_at >= row.created_at, `${ctx}: last_attempt_at >= created_at`).toBe(
        true,
      );
    }
  }
};

const it = extendWithResourceLeakDetection(extendWithPostgres(baseIt, import.meta.url), {
  additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
});

describe("fast seed v2 conformance", { timeout: 120_000 }, () => {
  it("produces identical data to seedAllStatesV2", async ({ postgresConnectionString }) => {
    const pool = new Pool({ connectionString: postgresConnectionString });
    const provider = createPgPoolProvider({ pool });
    const adapter = await createPgStateAdapter<PgPoolContext, string>({
      stateProvider: provider,
    });
    await adapter.migrateToLatest();

    for (const scale of [1, 2]) {
      // Reset
      await pool.query("DELETE FROM queuert_job_blocker");
      await pool.query("DELETE FROM queuert_job");

      // Correct seed
      await seedAllStatesV2(adapter, { scale });
      const { rows: correctJobs } = await pool.query<TimestampRow>(jobQuery);
      const { rows: correctBlockers } = await pool.query(blockerQuery);

      // Reset
      await pool.query("DELETE FROM queuert_job_blocker");
      await pool.query("DELETE FROM queuert_job");

      // Fast seed
      await fastSeedAllStatesV2(provider, { scale });
      const { rows: fastJobs } = await pool.query<TimestampRow>(jobQuery);
      const { rows: fastBlockers } = await pool.query(blockerQuery);

      // Structural equivalence (non-timestamp columns)
      const stripTimestamps = (row: TimestampRow) => {
        const {
          created_at: _,
          scheduled_at: _2,
          attempt_at: _3,
          attempt_until: _4,
          completed_at: _5,
          last_attempt_at: _6,
          ...rest
        } = row;
        return rest;
      };
      expect(fastJobs.map(stripTimestamps), `scale=${scale} structure`).toEqual(
        correctJobs.map(stripTimestamps),
      );
      expect(fastBlockers, `scale=${scale} blockers`).toEqual(correctBlockers);

      // Timestamp nullability must match (if correct has attempt_at set, fast must too)
      const toShape = (row: TimestampRow) => ({
        type_name: row.type_name,
        chain_index: row.chain_index,
        input_index: row.input_index,
        has_scheduled_at: row.scheduled_at != null,
        has_attempt_at: row.attempt_at != null,
        has_attempt_until: row.attempt_until != null,
        has_completed_at: row.completed_at != null,
        has_last_attempt_at: row.last_attempt_at != null,
      });
      expect(fastJobs.map(toShape), `scale=${scale} timestamp nullability`).toEqual(
        correctJobs.map(toShape),
      );

      // Temporal relationship correctness (both seeds must maintain valid ordering)
      assertTemporalRelationships(correctJobs, `scale=${scale} correct`);
      assertTemporalRelationships(fastJobs, `scale=${scale} fast`);
    }

    await pool.end();
  });
});
