import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import { acquirePostgres } from "@queuert/testcontainers";
import { type MigrationResult, createTemplateApplier } from "@queuert/typed-sql";
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
import { LEASE_TTL_MS, MARKER } from "./state-adapter-migration.process.js";

const ALL = migrations.map((migration) => migration.name);
const spawnDeployment = createDeploymentSpawner<MigrationResult>(
  join(import.meta.dirname, "state-adapter-migration.process.ts"),
  join(import.meta.dirname, "..", ".."),
);

type Provider = PgStateProvider<PgPoolContext>;
type Database = {
  connectionString: string;
  provider: Provider;
  adapter: Awaited<ReturnType<typeof createPgStateAdapter<PgPoolContext, string>>>;
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
  id_type: "text",
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
      generateId: (): string => randomUUID(),
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
      });
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
    ]);
  });

  it("is a no-op on a second run", { timeout: 120_000 }, async ({ database: { adapter } }) => {
    await adapter.migrateToLatest();
    expect(await adapter.migrateToLatest()).toEqual({
      applied: [],
      skipped: ALL,
      unrecognized: [],
    });
  });
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
