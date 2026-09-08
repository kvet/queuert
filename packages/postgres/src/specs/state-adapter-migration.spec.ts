import { randomUUID } from "node:crypto";

import { type AcquiredPostgres, acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";
import { type PgStateProvider } from "../state-provider/state-provider.pg.js";

const INSTALL = "001_initial_schema";
const ALL = [INSTALL];

type Provider = PgStateProvider<PgPoolContext>;
type Database = {
  provider: Provider;
  adapter: Awaited<ReturnType<typeof createPgStateAdapter<PgPoolContext, string>>>;
  pg: AcquiredPostgres;
};

const query = async <T = Record<string, unknown>>(provider: Provider, sql: string): Promise<T[]> =>
  provider.executeSql({
    sql,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: true,
  }) as Promise<T[]>;

const it = baseIt.extend<{ fresh: Database }>({
  // oxlint-disable-next-line no-empty-pattern
  fresh: async ({}, use) => {
    const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
    const pool = new Pool({ connectionString: pg.connectionString });
    const provider = createPgPoolProvider({ pool });
    const adapter = await createPgStateAdapter({
      stateProvider: provider,
      generateId: (): string => randomUUID(),
    });
    await use({ provider, adapter, pg });
    await pool.end();
    await pg[Symbol.asyncDispose]();
  },
});

const relations = async (provider: Provider): Promise<Record<string, boolean>> => {
  const [row] = await query<Record<string, string | null>>(
    provider,
    `SELECT to_regclass('public.queuert_job') AS job,
            to_regclass('public.queuert_job_blocker') AS job_blocker,
            to_regclass('public.queuert_migration') AS migration,
            to_regclass('public.queuert_migration_lock') AS migration_lock`,
  );
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, value !== null]));
};

const indexNames = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ indexname: string }>(
      provider,
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
    )
  ).map((row) => row.indexname);

describe("migrateToLatest", () => {
  it(
    "installs the schema on an empty database",
    { timeout: 120_000 },
    async ({ fresh: { provider, adapter } }) => {
      expect(await adapter.migrateToLatest()).toEqual({
        applied: ALL,
        skipped: [],
        unrecognized: [],
      });
      expect(await relations(provider)).toEqual({
        job: true,
        job_blocker: true,
        migration: true,
        migration_lock: true,
      });
    },
  );

  it("creates every index", { timeout: 120_000 }, async ({ fresh: { provider, adapter } }) => {
    await adapter.migrateToLatest();
    expect(await indexNames(provider)).toEqual([
      "queuert_chain_completed_idx",
      "queuert_chain_idx",
      "queuert_chain_index_idx",
      "queuert_chain_running_idx",
      "queuert_job_blocker_chain_idx",
      "queuert_job_blocker_pkey",
      "queuert_job_completed_idx",
      "queuert_job_deduplication_idx",
      "queuert_job_idx",
      "queuert_job_pending_idx",
      "queuert_job_pkey",
      "queuert_job_ready_idx",
      "queuert_job_running_idx",
      "queuert_migration_lock_pkey",
      "queuert_migration_pkey",
    ]);
  });

  it("is a no-op on a second run", { timeout: 120_000 }, async ({ fresh: { adapter } }) => {
    await adapter.migrateToLatest();
    expect(await adapter.migrateToLatest()).toEqual({
      applied: [],
      skipped: ALL,
      unrecognized: [],
    });
  });

  it(
    "serializes concurrent runs via the migration lease",
    { timeout: 180_000 },
    async ({ fresh: { provider, adapter } }) => {
      const [a, b] = await Promise.all([adapter.migrateToLatest(), adapter.migrateToLatest()]);

      const [winner, loser] = a.applied.length > 0 ? [a, b] : [b, a];
      expect(winner.applied).toEqual(ALL);
      expect(loser.applied).toEqual([]);
      expect(loser.skipped).toEqual(ALL);
      expect(await query(provider, "SELECT * FROM queuert_migration_lock")).toHaveLength(0);
    },
  );

  it("vacuum runs without error", { timeout: 120_000 }, async ({ fresh: { adapter } }) => {
    await adapter.migrateToLatest();
    await expect(adapter.vacuum()).resolves.toBeUndefined();
  });
});
