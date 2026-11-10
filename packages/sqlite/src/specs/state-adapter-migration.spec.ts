import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import { type MigrationResult, createMigrator, createTemplateApplier } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import {
  createMigrationStore,
  createSqliteStateAdapter,
  migrations,
} from "../state-adapter/state-adapter.sqlite.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";
import { MARKER } from "./state-adapter-migration.process.ts";
import { v017Migrations } from "./v0.17-migrations.spec-helper.ts";

const INSTALL = "001_initial_schema";
const ALL = migrations.map((migration) => migration.name);
const spawnDeployment = createDeploymentSpawner<MigrationResult>(
  join(import.meta.dirname, "state-adapter-migration.process.ts"),
  join(import.meta.dirname, "..", ".."),
);

type Provider = SqliteStateProvider<BetterSqlite3Context>;

const query = async <T>(provider: Provider, text: string): Promise<T[]> =>
  provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: { _: "string" },
    readOnly: true,
  }) as Promise<T[]>;

const names = async (provider: Provider, text: string): Promise<string[]> =>
  (await query<{ name: string }>(provider, text)).map((row) => row.name);

const appliedNames = async (provider: Provider): Promise<string[]> =>
  names(provider, "SELECT name FROM queuert_migration ORDER BY name");

const execute = async (provider: Provider, text: string): Promise<void> => {
  await provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: false,
  });
};

const migrateTo017 = async (
  provider: Provider,
  { only }: { only?: string } = {},
): Promise<void> => {
  await createMigrator<BetterSqlite3Context>({
    migrations: v017Migrations.filter((migration) => only === undefined || migration.name === only),
    store: createMigrationStore(
      provider,
      createTemplateApplier({
        table_prefix: "queuert_",
        job_id_type: "TEXT",
        worker_id_type: "TEXT",
      }),
    ),
  }).migrateToLatest();
};

const workerColumns = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ name: string; type: string; notnull: number }>(
      provider,
      "SELECT name, type, \"notnull\" FROM pragma_table_info('queuert_worker') ORDER BY name",
    )
  ).map((row) => `${row.name} ${row.type}${row.notnull === 1 ? " NOT NULL" : ""}`);

const jobColumnNames = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ name: string }>(provider, "SELECT name FROM pragma_table_info('queuert_job')")
  ).map((row) => row.name);

const schemaShape = async (provider: Provider): Promise<unknown> => {
  const tables = await names(
    provider,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'queuert_%' AND name NOT IN ('queuert_migration', 'queuert_write_lock') ORDER BY name",
  );
  return Promise.all(
    tables.map(async (table) => ({
      table,
      columns: await query(
        provider,
        `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`,
      ),
      indexes: await query(
        provider,
        `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' ORDER BY name`,
      ),
      checks: (
        await query<{ sql: string }>(
          provider,
          `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
        )
      ).map((row) => row.sql.match(/CHECK \([^)]*\)/g)),
    })),
  );
};

const it = baseIt.extend<{
  database: {
    path: string;
    provider: Provider;
    adapter: ReturnType<typeof createSqliteStateAdapter<BetterSqlite3Context, string>>;
  };
}>({
  // oxlint-disable-next-line no-empty-pattern
  database: async ({}, use) => {
    const path = join(tmpdir(), `queuert-migration-${randomUUID()}.sqlite`);
    const db = new Database(path, { timeout: 30_000 });
    db.pragma("journal_mode = WAL");
    const provider = createBetterSqlite3Provider({ db });
    const adapter = createSqliteStateAdapter({
      stateProvider: provider,
      generateJobId: (): string => randomUUID(),
    });
    await use({ path, provider, adapter });
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  },
});

describe("migrateToLatest", () => {
  it(
    "installs the schema on an empty database",
    { timeout: 60_000 },
    async ({ database: { provider, adapter } }) => {
      expect(await adapter.migrateToLatest()).toEqual({
        applied: ALL,
        skipped: [],
        unrecognized: [],
      });
      expect(await names(provider, "SELECT name FROM sqlite_master ORDER BY name")).toEqual([
        "queuert_chain_completed_idx",
        "queuert_chain_deduplication_idx",
        "queuert_chain_idx",
        "queuert_chain_index_idx",
        "queuert_chain_running_idx",
        "queuert_job",
        "queuert_job_attempt_by_idx",
        "queuert_job_blocked_idx",
        "queuert_job_blocker",
        "queuert_job_blocker_chain_idx",
        "queuert_job_completed_idx",
        "queuert_job_idx",
        "queuert_job_pending_idx",
        "queuert_job_running_idx",
        "queuert_migration",
        "queuert_schema_fence_v1",
        "queuert_worker",
        "queuert_worker_idx",
        "queuert_write_lock",
        "sqlite_autoindex_queuert_job_1",
        "sqlite_autoindex_queuert_job_blocker_1",
        "sqlite_autoindex_queuert_migration_1",
        "sqlite_autoindex_queuert_worker_1",
      ]);
      expect(await workerColumns(provider)).toEqual([
        "concurrency INTEGER NOT NULL",
        "id TEXT",
        "lease_until TEXT NOT NULL",
        "started_at TEXT NOT NULL",
        "token TEXT NOT NULL",
        "type_names TEXT NOT NULL",
      ]);
      expect(await jobColumnNames(provider)).toContain("attempt_token");
    },
  );

  it("is a no-op on a second run", { timeout: 60_000 }, async ({ database: { adapter } }) => {
    await adapter.migrateToLatest();
    expect(await adapter.migrateToLatest()).toEqual({
      applied: [],
      skipped: ALL,
      unrecognized: [],
    });
  });
});

describe("upgrading from 0.17", () => {
  it(
    "carries a 0.17 schema onto the squashed migration, matching a fresh install",
    { timeout: 60_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateTo017(provider);
      const freshDb = new Database(":memory:");
      const freshProvider = createBetterSqlite3Provider({ db: freshDb });
      await createSqliteStateAdapter({ stateProvider: freshProvider }).migrateToLatest();

      expect(await adapter.migrateToLatest()).toEqual({
        applied: [],
        skipped: [INSTALL],
        unrecognized: [],
      });
      expect(await appliedNames(provider)).toEqual([INSTALL]);
      expect(await schemaShape(provider)).toEqual(await schemaShape(freshProvider));
      freshDb.close();
      expect(await adapter.migrateToLatest()).toEqual({
        applied: [],
        skipped: [INSTALL],
        unrecognized: [],
      });
    },
  );

  it(
    "keeps the jobs and workers of a 0.17 schema as they are",
    { timeout: 60_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateTo017(provider);
      const workerId = randomUUID();
      const token = randomUUID();
      const jobId = randomUUID();
      await execute(
        provider,
        `INSERT INTO queuert_worker (id, lease_until, token, concurrency, type_names)
         VALUES ('${workerId}', datetime('now', 'subsec', '+60 seconds'), '${token}', 1, '["legacy"]')`,
      );
      await execute(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, attempt_at, attempt_by, attempt_token)
         VALUES ('${jobId}', 'legacy', '${jobId}', 0, 'running', 'running', 1, datetime('now', 'subsec'), '${workerId}', '${token}')`,
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
    "refuses a 0.16 schema, changing nothing",
    { timeout: 60_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateTo017(provider, { only: INSTALL });

      await expect(adapter.migrateToLatest()).rejects.toThrow(
        "Cannot upgrade a 0.16 schema directly. Upgrade it with @queuert/sqlite 0.17 first, then migrate to this version.",
      );
      expect(await appliedNames(provider)).toEqual([INSTALL]);
      expect(
        await names(provider, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"),
      ).toEqual(["queuert_job", "queuert_job_blocker", "queuert_migration", "queuert_write_lock"]);
    },
  );

  it(
    "refuses a 0.17 schema that records a migration 0.17 did not ship, changing nothing",
    { timeout: 60_000 },
    async ({ database: { provider, adapter } }) => {
      await migrateTo017(provider);
      await execute(provider, "INSERT INTO queuert_migration (name) VALUES ('003_unknown')");

      await expect(adapter.migrateToLatest()).rejects.toThrow(
        "Cannot upgrade the 0.17 schema: the migration table records 001_initial_schema, 002_worker_liveness, 003_unknown, but a 0.17 schema records exactly 001_initial_schema and 002_worker_liveness.",
      );
      expect(await appliedNames(provider)).toEqual([INSTALL, "002_worker_liveness", "003_unknown"]);
      expect(
        await names(
          provider,
          "SELECT name FROM sqlite_master WHERE name = 'queuert_schema_fence_v1'",
        ),
      ).toEqual([]);
    },
  );
});

describe("parallel deployments", () => {
  it(
    "applies the schema exactly once when several deployments migrate at the same time",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const results = await startTogether(
        Array.from({ length: 4 }, () => spawnDeployment(path, "older")),
      );

      expect(
        results.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual([
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: [], skipped: ALL, unrecognized: [] },
        { applied: ALL, skipped: [], unrecognized: [] },
      ]);
      expect(await appliedNames(provider)).toEqual(ALL);
    },
  );

  it(
    "rolls back the migration of a deployment killed mid-migration, and the next deployment applies it",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const killed = await startPaused(spawnDeployment(path, "older", "inside-migration"));
      await killed.kill();

      expect(
        await names(provider, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"),
      ).toEqual(["queuert_migration", "queuert_write_lock"]);
      expect(await startTogether([spawnDeployment(path, "older")])).toEqual([
        { applied: ALL, skipped: [], unrecognized: [] },
      ]);
      expect(await appliedNames(provider)).toEqual(ALL);
    },
  );

  it(
    "lets an older and a newer deployment migrate side by side",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const [older, newer] = (await startTogether([
        spawnDeployment(path, "older"),
        spawnDeployment(path, "newer"),
      ])) as MigrationResult[];

      expect([...older.applied, ...newer.applied].toSorted()).toEqual([...ALL, MARKER]);
      expect(newer.applied).toContain(MARKER);
      expect(await startTogether([spawnDeployment(path, "older")])).toEqual([
        { applied: [], skipped: ALL, unrecognized: [MARKER] },
      ]);
      expect(await appliedNames(provider)).toEqual([...ALL, MARKER]);
    },
  );
});
