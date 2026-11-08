import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import { acquirePostgres } from "@queuert/testcontainers";
import { type MigrationResult, createMigrator, createTemplateApplier } from "@queuert/typed-sql";
import { Client, Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import {
  createMigrationStore,
  createPgStateAdapter,
  migrations,
} from "../state-adapter/state-adapter.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";
import { LEASE_TTL_MS, MARKER } from "./state-adapter-migration.process.ts";

const INSTALL = "001_initial_schema";
const WORKER_LIVENESS = "002_worker_liveness";
const ALL = migrations.map((migration) => migration.name);
const spawnDeployment = createDeploymentSpawner<MigrationResult>(
  join(import.meta.dirname, "state-adapter-migration.process.ts"),
  join(import.meta.dirname, "..", ".."),
);

type Provider = PgStateProvider<PgPoolContext>;
type Database = {
  connectionString: string;
  provider: Provider;
  adapter: Awaited<ReturnType<typeof createPgStateAdapter<PgPoolContext, string, string>>>;
};

const query = async <T = Record<string, unknown>>(provider: Provider, text: string): Promise<T[]> =>
  provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: false,
  }) as Promise<T[]>;

const applyTemplate = createTemplateApplier({
  schema: "public",
  table_prefix: "queuert_",
  job_id_type: "text",
  worker_id_type: "text",
});

const appliedNames = async (provider: Provider): Promise<string[]> =>
  (await query<{ name: string }>(provider, "SELECT name FROM queuert_migration ORDER BY name")).map(
    (row) => row.name,
  );

const lockRows = async (provider: Provider): Promise<{ locked_by: string }[]> =>
  query(provider, "SELECT locked_by FROM queuert_migration_lock");

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const it = baseIt.extend<{ database: Database }>({
  // oxlint-disable-next-line no-empty-pattern
  database: async ({}, use) => {
    const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
    const pool = new Pool({ connectionString: pg.connectionString });
    const provider = createPgPoolProvider({ pool });
    const adapter = await createPgStateAdapter({
      stateProvider: provider,
      generateJobId: (): string => randomUUID(),
      generateWorkerId: (): string => randomUUID(),
    });
    await use({ connectionString: pg.connectionString, provider, adapter });
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
      createTemplateApplier({ schema: "public", table_prefix: "queuert_", job_id_type: "uuid" }),
    ),
  }).migrateToLatest();
};

const workerColumns = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ column_name: string; udt_name: string; is_nullable: string }>(
      provider,
      "SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'queuert_worker' ORDER BY column_name",
    )
  ).map(
    (row) => `${row.column_name} ${row.udt_name}${row.is_nullable === "NO" ? " NOT NULL" : ""}`,
  );

const jobColumnNames = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ column_name: string }>(
      provider,
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'queuert_job' ORDER BY column_name",
    )
  ).map((row) => row.column_name);

const indexDefinition = async (provider: Provider, indexName: string): Promise<string> => {
  const [row] = await query<{ indexdef: string }>(
    provider,
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${indexName}'`,
  );
  return row.indexdef;
};

describe("migrateToLatest", () => {
  it(
    "installs the schema on an empty database",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
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
        "id uuid NOT NULL",
        "lease_until timestamptz NOT NULL",
        "started_at timestamptz NOT NULL",
        "token uuid NOT NULL",
        "type_names _text NOT NULL",
      ]);
      expect(await jobColumnNames(provider)).not.toContain("attempt_until");
      expect(await jobColumnNames(provider)).toContain("attempt_token");
    },
  );

  it("creates every index", { timeout: 120_000 }, async ({ database: { provider, adapter } }) => {
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
      "queuert_worker_idx",
      "queuert_worker_pkey",
    ]);
    expect(await indexDefinition(provider, "queuert_job_running_idx")).toBe(
      "CREATE INDEX queuert_job_running_idx ON public.queuert_job USING btree (type_name, attempt_at) WHERE (status = 'running'::text)",
    );
  });

  it("is a no-op on a second run", { timeout: 120_000 }, async ({ database: { adapter } }) => {
    await adapter.migrateToLatest();
    expect(await adapter.migrateToLatest()).toEqual({
      applied: [],
      skipped: ALL,
      unrecognized: [],
    });
  });

  it(
    "upgrades a database with jobs of the previous version, returning running jobs to pending and clearing their worker IDs",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const jobId = randomUUID();
      const completedJobId = randomUUID();
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, attempt_at, attempt_by, attempt_until)
         VALUES ('${jobId}', 'legacy', '${jobId}', 0, 'running', 'running', 1, now(), 'worker-${randomUUID()}', now() + interval '60 seconds')`,
      );
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, completed_at, completed_by, chain_completed_at)
         VALUES ('${completedJobId}', 'legacy', '${completedJobId}', 0, 'completed', 'completed', 1, now(), 'worker-${randomUUID()}', now())`,
      );

      expect(await adapter.migrateToLatest()).toEqual({
        applied: [WORKER_LIVENESS],
        skipped: [INSTALL],
        unrecognized: [],
      });
      expect(await relations(provider)).toMatchObject({ worker: true });
      expect(await jobColumnNames(provider)).not.toContain("attempt_until");
      expect(await indexDefinition(provider, "queuert_job_running_idx")).toBe(
        "CREATE INDEX queuert_job_running_idx ON public.queuert_job USING btree (type_name, attempt_at) WHERE (status = 'running'::text)",
      );

      const [running] = await adapter.getJobs({ jobIds: [jobId] });
      expect(running!.status).toBe("pending");
      expect(running!.attempt).toBe(1);
      expect(running!.attemptAt).toBeNull();
      expect(running!.attemptBy).toBeNull();
      expect(running!.attemptToken).toBeNull();

      const [completed] = await adapter.getJobs({ jobIds: [completedJobId] });
      expect(completed!.status).toBe("completed");
      expect(completed!.completedBy).toBeNull();
    },
  );

  it(
    "gives up when an open transaction holds a lock on the job table, and applies once it ends",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider, adapter } }) => {
      await migrateToInstall(provider);
      const blocker = new Client({ connectionString });
      await blocker.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT 1 FROM queuert_job LIMIT 1");

        await expect(adapter.migrateToLatest()).rejects.toMatchObject({ code: "55P03" });

        await blocker.query("ROLLBACK");
      } finally {
        await blocker.end();
      }

      expect(await adapter.migrateToLatest()).toEqual({
        applied: [WORKER_LIVENESS],
        skipped: [INSTALL],
        unrecognized: [],
      });
    },
  );

  it(
    "upgrades without rewriting the job table",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const filenodeQuery = `SELECT pg_relation_filenode('queuert_job')::text AS filenode`;
      const [before] = await query(provider, filenodeQuery);

      await adapter.migrateToLatest();

      expect(await query(provider, filenodeQuery)).toEqual([before]);
    },
  );
});

describe("parallel deployments", () => {
  it(
    "applies the schema exactly once when several deployments migrate at the same time",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const results = await startTogether(
        Array.from({ length: 5 }, () => spawnDeployment(connectionString, "older")),
      );

      expect(
        results.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual([
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: ALL, skipped: [], unrecognized: [] },
      ]);
      expect(await appliedNames(provider)).toEqual(ALL);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "keeps the lease past its TTL while the holder is busy, and the waiter skips the holder's work",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const holder = await startPaused(
        spawnDeployment(connectionString, "older", "before-migrating"),
      );
      const waiter = spawnDeployment(connectionString, "older");
      await waiter.waitFor("ready");
      waiter.go();

      await sleep(LEASE_TTL_MS * 2);
      expect(waiter.finished()).toBe(false);

      holder.go();
      expect(await holder.result()).toEqual({ applied: ALL, skipped: [], unrecognized: [] });
      expect(await waiter.result()).toEqual({ applied: [], skipped: ALL, unrecognized: [] });
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "rolls back the migration of a deployment killed mid-migration and takes over its lease once it expires",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const killed = await startPaused(
        spawnDeployment(connectionString, "older", "inside-migration"),
      );
      await killed.kill();

      expect(await appliedNames(provider)).toEqual([]);
      expect(await lockRows(provider)).toHaveLength(1);

      const startedAt = performance.now();
      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        { applied: ALL, skipped: [], unrecognized: [] },
      ]);
      expect(performance.now() - startedAt).toBeGreaterThan(LEASE_TTL_MS / 2);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "aborts a deployment frozen before migrating once it resumes after another deployment migrated in its place",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const frozen = await startPaused(
        spawnDeployment(connectionString, "newer", "before-migrating"),
      );
      frozen.freeze();
      await sleep(LEASE_TTL_MS + 500);

      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        { applied: ALL, skipped: [], unrecognized: [] },
      ]);

      frozen.thaw();
      frozen.go();
      expect(await frozen.result()).toEqual({
        error: expect.stringMatching(/Migration lock lost/),
      });
      expect(await appliedNames(provider)).toEqual(ALL);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "aborts a deployment frozen mid-migration once it resumes, while the deployment that took over finishes the rest",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const frozen = await startPaused(
        spawnDeployment(connectionString, "newer", "inside-migration"),
      );
      frozen.freeze();
      await sleep(LEASE_TTL_MS + 500);

      const takingOver = spawnDeployment(connectionString, "older");
      await takingOver.waitFor("ready");
      takingOver.go();
      await sleep(500);
      expect(takingOver.finished()).toBe(false);

      frozen.thaw();
      frozen.go();
      expect(await frozen.result()).toEqual({
        error: expect.stringMatching(/Migration lock lost/),
      });
      expect(await takingOver.result()).toEqual({
        applied: ALL.slice(1),
        skipped: ALL.slice(0, 1),
        unrecognized: [],
      });
      expect(await appliedNames(provider)).toEqual(ALL);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "lets an older and a newer deployment migrate side by side",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider } }) => {
      const [older, newer] = (await startTogether([
        spawnDeployment(connectionString, "older"),
        spawnDeployment(connectionString, "newer"),
      ])) as MigrationResult[];

      expect([...older.applied, ...newer.applied].toSorted()).toEqual([...ALL, MARKER]);
      expect(newer.applied).toContain(MARKER);
      expect(await startTogether([spawnDeployment(connectionString, "older")])).toEqual([
        { applied: [], skipped: ALL, unrecognized: [MARKER] },
      ]);
      expect(await appliedNames(provider)).toEqual([...ALL, MARKER]);
    },
  );
});

describe("migration lease", () => {
  it(
    "is fenced by its owner, so an expired lease stays extendable until another owner claims it",
    { timeout: 120_000 },
    async ({ database: { provider } }) => {
      const store = createMigrationStore(provider, applyTemplate);
      await store.initialize?.();
      const expire = async (): Promise<void> => {
        await query(
          provider,
          "UPDATE queuert_migration_lock SET locked_until = now() - interval '1 second'",
        );
      };

      expect(await store.acquireMigrationLock!("first", 60_000)).toBe(true);
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(false);
      expect(await store.acquireMigrationLock!("first", 60_000)).toBe(false);

      await expire();
      expect(await store.extendMigrationLock!("first", 60_000)).toBe(true);
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(false);

      await expire();
      expect(await store.acquireMigrationLock!("second", 60_000)).toBe(true);
      expect(await store.extendMigrationLock!("first", 60_000)).toBe(false);

      await store.releaseMigrationLock!("first");
      expect(await lockRows(provider)).toEqual([{ locked_by: "second" }]);
      await store.releaseMigrationLock!("second");
      expect(await lockRows(provider)).toEqual([]);
      expect(await store.extendMigrationLock!("second", 60_000)).toBe(false);
    },
  );
});
