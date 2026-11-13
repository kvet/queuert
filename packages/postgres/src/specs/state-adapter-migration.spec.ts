import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import { acquirePostgres } from "@queuert/testcontainers";
import { type MigrationResult, createMigrator } from "@queuert/typed-sql/migrator";
import { createTemplateExecutor } from "@queuert/typed-sql/sql-executor";
import { createTemplateApplier } from "@queuert/typed-sql/template-applier";
import { Client, Pool } from "pg";
import { it as baseIt, describe, expect, vi } from "vitest";

import {
  createMigrationStore,
  createPgStateAdapter,
  createSchemaMigrations,
} from "../state-adapter/state-adapter.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";
import { LEASE_TTL_MS, MARKER } from "./state-adapter-migration.process.ts";
import { createV017Migrations } from "./v0.17-migrations.spec-helper.ts";

const INSTALL = "001_initial_schema";
const ALL = createSchemaMigrations(async () => {}).map((migration) => migration.name);
const spawnDeployment = createDeploymentSpawner<MigrationResult>(
  join(import.meta.dirname, "state-adapter-migration.process.ts"),
  join(import.meta.dirname, "..", ".."),
);

type Provider = PgStateProvider<PgPoolContext>;
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

// oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
const it = baseIt.extend("database", async ({}, { onCleanup }) => {
  const pg = await acquirePostgres("postgres:14", `pg-migration-${randomUUID()}`);
  const pool = new Pool({ connectionString: pg.connectionString });
  onCleanup(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });
  const provider = createPgPoolProvider({ pool });
  const adapter = createPgStateAdapter({
    stateProvider: provider,
    generateJobId: (): string => randomUUID(),
    generateWorkerId: (): string => randomUUID(),
  });
  return { connectionString: pg.connectionString, provider, adapter };
});

const relations = async (provider: Provider): Promise<Record<string, boolean>> => {
  const [row] = await query<Record<string, string | null>>(
    provider,
    `SELECT to_regclass('public.queuert_job') AS job,
            to_regclass('public.queuert_job_blocker') AS job_blocker,
            to_regclass('public.queuert_migration') AS migration,
            to_regclass('public.queuert_migration_lock') AS migration_lock,
            to_regclass('public.queuert_worker') AS worker,
            to_regclass('public.queuert_schema_fence_v1') AS schema_fence_v1`,
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

const migrateTo017 = async (
  provider: Provider,
  { only }: { only?: string } = {},
): Promise<void> => {
  const applyTemplate017 = createTemplateApplier({
    schema: "public",
    table_prefix: "queuert_",
    job_id_type: "uuid",
    worker_id_type: "uuid",
  });
  await createMigrator({
    migrations: createV017Migrations(createTemplateExecutor(provider, applyTemplate017)).filter(
      (migration) => only === undefined || migration.name === only,
    ),
    store: createMigrationStore(provider, applyTemplate017),
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

const schemaShape = async (provider: Provider, schema: string): Promise<unknown> => {
  const strip = (text: string): string => text.replaceAll(`${schema}.`, "");
  const columns = await query(
    provider,
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = '${schema}' AND table_name NOT LIKE 'queuert_migration%'
     ORDER BY table_name, ordinal_position`,
  );
  const indexes = await query<{ indexname: string; indexdef: string }>(
    provider,
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = '${schema}' AND tablename NOT LIKE 'queuert_migration%'
     ORDER BY indexname`,
  );
  const constraints = await query<{ conname: string; definition: string }>(
    provider,
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = '${schema}' AND c.conname NOT LIKE 'queuert_migration%'
     ORDER BY c.conname`,
  );
  const tables = await query(
    provider,
    `SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = '${schema}' AND c.relkind = 'r' AND c.relname NOT LIKE 'queuert_migration%'
     ORDER BY c.relname`,
  );
  return {
    columns,
    indexes: indexes.map((row) => ({ ...row, indexdef: strip(row.indexdef) })),
    constraints,
    tables,
  };
};

describe("migrateToLatest", () => {
  it("names its migrations NNN_name, in ascending order", () => {
    for (const name of ALL) expect(name).toMatch(/^\d{3}_[a-z][a-z0-9_]*$/);
    expect(ALL).toEqual(ALL.toSorted());
  });

  it(
    "installs the schema on an empty database",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      expect(await adapter.migrateToLatest()).toEqual({
        applied: [INSTALL],
        skipped: [],
        reverted: [],
        unrecognized: [],
      });
      expect(await relations(provider)).toEqual({
        job: true,
        job_blocker: true,
        migration: true,
        migration_lock: true,
        worker: true,
        schema_fence_v1: true,
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
      "queuert_schema_fence_v1_pkey",
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
      reverted: [],
      unrecognized: [],
    });
  });
});

describe("upgrading from 0.17", () => {
  it(
    "carries a 0.17 schema onto the squashed migration, matching a fresh install",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateTo017(provider);
      await query(provider, "CREATE SCHEMA fresh");
      await createPgStateAdapter({ stateProvider: provider, schema: "fresh" }).migrateToLatest();

      expect(await adapter.migrateToLatest()).toEqual({
        applied: [],
        skipped: [INSTALL],
        reverted: [],
        unrecognized: [],
      });
      expect(await appliedNames(provider)).toEqual([INSTALL]);
      expect(await relations(provider)).toMatchObject({ schema_fence_v1: true });
      expect(await schemaShape(provider, "public")).toEqual(await schemaShape(provider, "fresh"));
      expect(await adapter.migrateToLatest()).toEqual({
        applied: [],
        skipped: [INSTALL],
        reverted: [],
        unrecognized: [],
      });
    },
  );

  it(
    "keeps the jobs and workers of a 0.17 schema as they are",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateTo017(provider);
      const workerId = randomUUID();
      const token = randomUUID();
      const jobId = randomUUID();
      await query(
        provider,
        `INSERT INTO queuert_worker (id, lease_until, token, concurrency, type_names)
         VALUES ('${workerId}', now() + interval '60 seconds', '${token}', 1, ARRAY['legacy'])`,
      );
      await query(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, attempt_at, attempt_by, attempt_token)
         VALUES ('${jobId}', 'legacy', '${jobId}', 0, 'running', 'running', 1, now(), '${workerId}', '${token}')`,
      );

      await adapter.migrateToLatest();

      const [job] = await adapter.getJobs({ jobIds: [jobId] });
      expect(job!.status).toBe("running");
      expect(job!.attemptBy).toBe(workerId);
      expect(job!.attemptToken).toBe(token);
      const [worker] = await adapter.getWorkers({ workerIds: [workerId] });
      expect(worker!.id).toBe(workerId);
    },
  );

  it(
    "upgrades while a 0.17 transaction holds the job and worker tables",
    { timeout: 120_000 },
    async ({ database: { connectionString, provider, adapter } }) => {
      await migrateTo017(provider);
      const worker017 = new Client({ connectionString });
      await worker017.connect();
      try {
        await worker017.query("BEGIN");
        await worker017.query(
          "LOCK TABLE queuert_job, queuert_job_blocker, queuert_worker IN ROW EXCLUSIVE MODE",
        );

        expect(await adapter.migrateToLatest()).toEqual({
          applied: [],
          skipped: [INSTALL],
          reverted: [],
          unrecognized: [],
        });

        await worker017.query("COMMIT");
      } finally {
        await worker017.end();
      }
    },
  );

  it(
    "refuses a 0.16 schema, changing nothing",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateTo017(provider, { only: INSTALL });

      await expect(adapter.migrateToLatest()).rejects.toThrow(
        "Cannot upgrade a 0.16 schema directly. Upgrade it with @queuert/postgres 0.17 first, then migrate to this version.",
      );
      expect(await appliedNames(provider)).toEqual([INSTALL]);
      expect(await relations(provider)).toMatchObject({ worker: false, schema_fence_v1: false });
    },
  );

  it(
    "refuses a 0.17 schema that records a migration 0.17 did not ship, changing nothing",
    { timeout: 120_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateTo017(provider);
      await query(provider, "INSERT INTO queuert_migration (name) VALUES ('003_unknown')");

      await expect(adapter.migrateToLatest()).rejects.toThrow(
        "Cannot upgrade the 0.17 schema: the migration table records 001_initial_schema, 002_worker_liveness, 003_unknown, but a 0.17 schema records exactly 001_initial_schema and 002_worker_liveness.",
      );
      expect(await appliedNames(provider)).toEqual([INSTALL, "002_worker_liveness", "003_unknown"]);
      expect(await relations(provider)).toMatchObject({ schema_fence_v1: false });
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
        { applied: [], skipped: ALL, reverted: [], unrecognized: [] },
        { applied: [], skipped: ALL, reverted: [], unrecognized: [] },
        { applied: [], skipped: ALL, reverted: [], unrecognized: [] },
        { applied: [], skipped: ALL, reverted: [], unrecognized: [] },
        { applied: ALL, skipped: [], reverted: [], unrecognized: [] },
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
      expect(await holder.result()).toEqual({
        applied: ALL,
        skipped: [],
        reverted: [],
        unrecognized: [],
      });
      expect(await waiter.result()).toEqual({
        applied: [],
        skipped: ALL,
        reverted: [],
        unrecognized: [],
      });
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
        { applied: ALL, skipped: [], reverted: [], unrecognized: [] },
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
        { applied: ALL, skipped: [], reverted: [], unrecognized: [] },
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
      const [{ locked_by: frozenOwner }] = await lockRows(provider);
      await sleep(LEASE_TTL_MS + 500);

      const takingOver = spawnDeployment(connectionString, "older");
      await takingOver.waitFor("ready");
      takingOver.go();
      await vi.waitFor(
        async () => {
          expect((await lockRows(provider))[0]?.locked_by).not.toBe(frozenOwner);
        },
        { timeout: 30_000, interval: 50 },
      );
      expect(takingOver.finished()).toBe(false);

      frozen.thaw();
      frozen.go();
      expect(await frozen.result()).toEqual({
        error: expect.stringMatching(/Migration lock lost/),
      });
      expect(await takingOver.result()).toEqual({
        applied: ALL.slice(1),
        skipped: ALL.slice(0, 1),
        reverted: [],
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
        { applied: [], skipped: ALL, reverted: [], unrecognized: [MARKER] },
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
