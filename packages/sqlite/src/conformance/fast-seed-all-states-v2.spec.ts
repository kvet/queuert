import Database from "better-sqlite3";
import { seedAllStatesV2 } from "queuert/testing";
import { it as baseIt, describe, expect } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";
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
  FROM queuert_job
  ORDER BY type_name, chain_index,
    CAST(json_extract(input, '$.index') AS INTEGER),
    CAST(json_extract(input, '$.n') AS INTEGER)
`;

const blockerQuery = `
  SELECT
    j.type_name AS job_type_name,
    bj.type_name AS blocker_type_name,
    b."index" AS blocker_index
  FROM queuert_job_blocker b
  JOIN queuert_job j ON j.id = b.job_id
  JOIN queuert_job bj ON bj.id = b.blocked_by_chain_id
  ORDER BY j.type_name, bj.type_name, b."index"
`;

type TimestampRow = {
  type_name: string;
  chain_index: number;
  input_index: number | null;
  created_at: string;
  scheduled_at: string;
  attempt_at: string | null;
  attempt_until: string | null;
  completed_at: string | null;
  last_attempt_at: string | null;
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

const it = baseIt;

const createDb = () => {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("foreign_keys = ON");
  return db;
};

describe("fast seed v2 conformance", { timeout: 120_000 }, () => {
  it("produces identical data to seedAllStatesV2", async () => {
    for (const scale of [1, 2]) {
      // Correct seed
      const correctDb = createDb();
      const correctProvider = createBetterSqlite3Provider({ db: correctDb });
      const correctAdapter = await createSqliteStateAdapter<BetterSqlite3Context, string>({
        stateProvider: correctProvider,
      });
      await correctAdapter.migrateToLatest();
      await seedAllStatesV2(correctAdapter, { scale });
      correctDb.exec("ANALYZE");
      const correctJobs = correctDb.prepare(jobQuery).all() as TimestampRow[];
      const correctBlockers = correctDb.prepare(blockerQuery).all();

      // Fast seed
      const fastDb = createDb();
      const fastProvider = createBetterSqlite3Provider({ db: fastDb });
      const fastAdapter = await createSqliteStateAdapter<BetterSqlite3Context, string>({
        stateProvider: fastProvider,
      });
      await fastAdapter.migrateToLatest();
      await fastSeedAllStatesV2(fastProvider, { scale });
      fastDb.exec("ANALYZE");
      const fastJobs = fastDb.prepare(jobQuery).all() as TimestampRow[];
      const fastBlockers = fastDb.prepare(blockerQuery).all();

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

      // Timestamp nullability must match
      const toShape = (row: TimestampRow) => ({
        type_name: row.type_name,
        chain_index: row.chain_index,
        has_scheduled_at: row.scheduled_at != null,
        has_attempt_at: row.attempt_at != null,
        has_attempt_until: row.attempt_until != null,
        has_completed_at: row.completed_at != null,
        has_last_attempt_at: row.last_attempt_at != null,
      });
      expect(fastJobs.map(toShape), `scale=${scale} timestamp nullability`).toEqual(
        correctJobs.map(toShape),
      );

      // Temporal relationship correctness
      assertTemporalRelationships(correctJobs, `scale=${scale} correct`);
      assertTemporalRelationships(fastJobs, `scale=${scale} fast`);

      correctDb.close();
      fastDb.close();
    }
  });
});
