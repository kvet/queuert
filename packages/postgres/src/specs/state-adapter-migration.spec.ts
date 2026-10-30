import { randomUUID } from "node:crypto";

import { type AcquiredPostgres, acquirePostgres } from "@queuert/testcontainers";
import { createMigrator, createTemplateApplier } from "@queuert/typed-sql";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import {
  createMigrationStore,
  createPgStateAdapter,
  migrations,
} from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";
import { type PgStateProvider } from "../state-provider/state-provider.pg.js";

const INSTALL = "001_initial_schema";
const WORKER_LIVENESS = "002_worker_liveness";
const ALL = [INSTALL, WORKER_LIVENESS];

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
            to_regclass('public.queuert_migration_lock') AS migration_lock,
            to_regclass('public.queuert_worker') AS worker`,
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

const migrateToInstall = async (provider: Provider): Promise<void> => {
  await createMigrator<PgPoolContext>({
    migrations: migrations.filter((migration) => migration.name === INSTALL),
    store: createMigrationStore(
      provider,
      createTemplateApplier({ schema: "public", table_prefix: "queuert_", id_type: "uuid" }),
    ),
  }).migrateToLatest();
};

const jobColumnNames = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ column_name: string }>(
      provider,
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'queuert_job' ORDER BY column_name",
    )
  ).map((row) => row.column_name);

const workerColumns = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ column_name: string; udt_name: string; is_nullable: string }>(
      provider,
      "SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'queuert_worker' ORDER BY column_name",
    )
  ).map(
    (row) => `${row.column_name} ${row.udt_name}${row.is_nullable === "NO" ? " NOT NULL" : ""}`,
  );

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
        worker: true,
      });
      expect(await workerColumns(provider)).toEqual([
        "concurrency int4 NOT NULL",
        "id text NOT NULL",
        "lease_until timestamptz NOT NULL",
        "name text",
        "started_at timestamptz NOT NULL",
        "type_names _text NOT NULL",
      ]);
    },
  );

  it("creates every index", { timeout: 120_000 }, async ({ fresh: { provider, adapter } }) => {
    await adapter.migrateToLatest();
    expect(await indexNames(provider)).toEqual([
      "queuert_chain_completed_idx",
      "queuert_chain_deduplication_idx",
      "queuert_chain_idx",
      "queuert_chain_index_idx",
      "queuert_chain_running_idx",
      "queuert_job_attempt_by_idx",
      "queuert_job_blocked_idx",
      "queuert_job_blocker_chain_idx",
      "queuert_job_blocker_pkey",
      "queuert_job_completed_idx",
      "queuert_job_idx",
      "queuert_job_pending_idx",
      "queuert_job_pkey",
      "queuert_job_running_idx",
      "queuert_migration_lock_pkey",
      "queuert_migration_pkey",
      "queuert_worker_pkey",
    ]);
    expect(await jobColumnNames(provider)).not.toContain("attempt_until");
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

  it(
    "upgrades a database with running jobs of the previous version, which reclaim returns to pending",
    { timeout: 120_000 },
    async ({ fresh: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const jobId = randomUUID();
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, attempt_at, attempt_by, attempt_until)
         VALUES ('${jobId}', 'legacy', '${jobId}', 0, 'running', 'running', 1, now(), 'legacy-worker', now() + interval '60 seconds')`,
      );

      expect(await adapter.migrateToLatest()).toEqual({
        applied: [WORKER_LIVENESS],
        skipped: [INSTALL],
        unrecognized: [],
      });
      expect(await jobColumnNames(provider)).not.toContain("attempt_until");

      const [running] = await adapter.getJobs({ jobIds: [jobId] });
      expect(running!.status).toBe("running");
      expect(running!.attemptBy).toBe("legacy-worker");

      const [reclaimed] = await adapter.reclaimExpiredJobAttempts({
        lastAttemptError: "JobAttemptReclaimedError: upgraded",
        limit: 1,
      });
      expect(reclaimed.id).toBe(jobId);
      expect(reclaimed.status).toBe("pending");
      expect(reclaimed.reclaimedFrom).toEqual({ workerId: "legacy-worker", workerName: null });
    },
  );
});
