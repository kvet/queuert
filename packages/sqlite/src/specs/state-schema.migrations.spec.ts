import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import type { MaybePromise, Mode } from "@queuert/sync-async";
import {
  type MigrationResult,
  createMigrator,
  createTemplateApplier,
  createTypedSqlExecutor,
} from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import {
  createMigrationStore,
  createSchemaMigrations,
} from "../state-adapter/state-schema.migrations.sqlite.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";
import { MARKER } from "./state-schema.migrations.process.ts";

const INSTALL = "001_schema_v1";
const ALL = createSchemaMigrations(async () => {}, "async").map((migration) => migration.name);
const spawnerIn = (mode: Mode) =>
  createDeploymentSpawner<MigrationResult>(
    join(import.meta.dirname, "state-schema.migrations.process.ts"),
    join(import.meta.dirname, "..", ".."),
    [mode],
  );

type Provider = SqliteStateProvider<BetterSqlite3Context, Mode>;

const query = async <T>(provider: Provider, text: string): Promise<T[]> =>
  provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: { _: "string" },
    readOnly: true,
  }) as MaybePromise<T[]>;

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

const migrateThroughHistory = async (
  provider: Provider,
  tablePrefix: string,
  migrationNames: string[],
): Promise<MigrationResult> => {
  const mode = provider.sync === true ? "sync" : "async";
  const applyTemplateHistory = createTemplateApplier({
    table_prefix: tablePrefix,
    migration_table: `${tablePrefix}migration`,
    write_lock_table: `${tablePrefix}write_lock`,
    job_id_type: "TEXT",
    worker_id_type: "TEXT",
  });
  const exec = createTypedSqlExecutor(provider);
  return createMigrator({
    mode,
    migrations: createSchemaMigrations(
      (txCtx: BetterSqlite3Context, statement) =>
        exec({ txCtx, sql: applyTemplateHistory(statement) }),
      mode,
    ).filter((migration) => migrationNames.includes(migration.name)),
    store: createMigrationStore(provider, applyTemplateHistory),
  }).migrateToLatest();
};

const schemaStructure = async (provider: Provider, tablePrefix: string) => {
  const unprefixed = (name: string): string => name.replace(tablePrefix, "");
  const entries = (
    await query<{ type: string; name: string; tbl_name: string; sql: string | null }>(
      provider,
      "SELECT type, name, tbl_name, sql FROM sqlite_schema",
    )
  ).filter((entry) => entry.tbl_name.startsWith(tablePrefix));
  const structure = await Promise.all(
    entries.map(async (entry) => ({
      type: entry.type,
      name: unprefixed(entry.name),
      tableName: unprefixed(entry.tbl_name),
      sql:
        entry.sql
          ?.replaceAll(tablePrefix, "")
          .replace(/\s+/g, " ")
          .replace(/\s*([(),])\s*/g, "$1") ?? null,
      columns:
        entry.type === "table"
          ? await query(provider, `SELECT * FROM pragma_table_xinfo('${entry.name}')`)
          : [],
      indexes:
        entry.type === "table"
          ? (
              await query<{ name: string }>(
                provider,
                `SELECT * FROM pragma_index_list('${entry.name}') ORDER BY name`,
              )
            ).map((index) => ({ ...index, name: unprefixed(index.name) }))
          : [],
      indexColumns:
        entry.type === "index"
          ? await query(provider, `SELECT * FROM pragma_index_xinfo('${entry.name}')`)
          : [],
    })),
  );
  return structure.toSorted((a, b) => a.name.localeCompare(b.name));
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

const itIn = (mode: Mode) =>
  // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
  baseIt.extend("database", async ({}, { onCleanup }) => {
    const path = join(tmpdir(), `queuert-migration-${randomUUID()}.sqlite`);
    const db = new Database(path, { timeout: 30_000 });
    db.pragma("journal_mode = WAL");
    onCleanup(async () => {
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
    });
    const provider = createBetterSqlite3Provider({ db, mode });
    const adapter = createSqliteStateAdapter({
      stateProvider: provider,
      generateJobId: (): string => randomUUID(),
    });
    return { path, provider, adapter };
  });

baseIt("names its migrations NNN_name, in ascending order", () => {
  for (const name of ALL) expect(name).toMatch(/^\d{3}_[a-z][a-z0-9_]*$/);
  expect(ALL).toEqual(ALL.toSorted());
});

describe.each(["async", "sync"] as const)("in %s mode", (mode) => {
  const it = itIn(mode);
  const spawnDeployment = spawnerIn(mode);

  describe("migrateToLatest", () => {
    it(
      "installs the schema on an empty database",
      { timeout: 60_000 },
      async ({ database: { provider, adapter } }) => {
        expect(await adapter.migrateToLatest()).toEqual({
          applied: ALL,
          skipped: [],
          reverted: [],
          unrecognized: [],
        });
        expect(await names(provider, "SELECT name FROM sqlite_master ORDER BY name")).toEqual([
          "queuert_chain_blocking_idx",
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
          "queuert_schema_fence_v2",
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

    it(
      "creates the same schema on an empty database as the migration history does",
      { timeout: 60_000 },
      async ({ database: { provider, adapter } }) => {
        expect(await migrateThroughHistory(provider, "history_", ALL)).toEqual({
          applied: ALL,
          skipped: [],
          reverted: [],
          unrecognized: [],
        });
        expect(await adapter.migrateToLatest()).toEqual({
          applied: ALL,
          skipped: [],
          reverted: [],
          unrecognized: [],
        });

        const history = await schemaStructure(provider, "history_");
        expect(history.map((entry) => entry.name)).toContain("job");
        expect(await schemaStructure(provider, "queuert_")).toEqual(history);

        const customAdapter = createSqliteStateAdapter({
          stateProvider: provider,
          tablePrefix: "custom_",
          generateJobId: (): string => randomUUID(),
        });
        expect(await customAdapter.migrateToLatest()).toEqual({
          applied: ALL,
          skipped: [],
          reverted: [],
          unrecognized: [],
        });
        expect(await schemaStructure(provider, "custom_")).toEqual(history);
        expect(await appliedNames(provider)).toEqual(ALL);
      },
    );

    it("is a no-op on a second run", { timeout: 60_000 }, async ({ database: { adapter } }) => {
      await adapter.migrateToLatest();
      expect(await adapter.migrateToLatest()).toEqual({
        applied: [],
        skipped: ALL,
        reverted: [],
        unrecognized: [],
      });
    });
  });

  describe("upgrading from 001_schema_v1", () => {
    it(
      "flags the chains that blocker rows reference and replaces the write fence",
      { timeout: 60_000 },
      async ({ database: { provider, adapter } }) => {
        await migrateThroughHistory(provider, "queuert_", [INSTALL]);
        const blockerChainId = randomUUID();
        const continuedBlockerChainId = randomUUID();
        const continuedBlockerTailId = randomUUID();
        const unreferencedChainId = randomUUID();
        const dependentId = randomUUID();
        await execute(
          provider,
          `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, continued_to_id)
           VALUES ('${blockerChainId}', 'blocker', '${blockerChainId}', 0, 'pending', 'running', NULL),
                  ('${continuedBlockerChainId}', 'blocker', '${continuedBlockerChainId}', 0, 'completed', 'running', '${continuedBlockerTailId}'),
                  ('${continuedBlockerTailId}', 'blocker', '${continuedBlockerChainId}', 1, 'pending', NULL, NULL),
                  ('${unreferencedChainId}', 'unreferenced', '${unreferencedChainId}', 0, 'pending', 'running', NULL),
                  ('${dependentId}', 'dependent', '${dependentId}', 0, 'blocked', 'running', NULL)`,
        );
        await execute(
          provider,
          `INSERT INTO queuert_job_blocker (job_id, blocked_by_chain_id, "index")
           VALUES ('${dependentId}', '${blockerChainId}', 0),
                  ('${dependentId}', '${continuedBlockerChainId}', 1)`,
        );

        expect(await adapter.migrateToLatest()).toEqual({
          applied: ["002_schema_v2"],
          skipped: [INSTALL],
          reverted: [],
          unrecognized: [],
        });
        expect(
          await names(
            provider,
            "SELECT name FROM sqlite_master WHERE name LIKE 'queuert_schema_fence_%' ORDER BY name",
          ),
        ).toEqual(["queuert_schema_fence_v2"]);

        expect(
          await names(
            provider,
            "SELECT id AS name FROM queuert_job WHERE blocking = 1 ORDER BY id",
          ),
        ).toEqual([blockerChainId, continuedBlockerChainId].toSorted());
      },
    );

    it(
      "counts one failure for a job that stored an attempt error, and none for a job without one",
      { timeout: 60_000 },
      async ({ database: { provider, adapter } }) => {
        await migrateThroughHistory(provider, "queuert_", [INSTALL]);
        const failedJobId = randomUUID();
        const cleanJobId = randomUUID();
        await execute(
          provider,
          `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, last_attempt_at, last_attempt_error)
           VALUES ('${failedJobId}', 'legacy', '${failedJobId}', 0, 'pending', 'running', 3, datetime('now', 'subsec'), '"Error: boom"'),
                  ('${cleanJobId}', 'legacy', '${cleanJobId}', 0, 'pending', 'running', 2, NULL, NULL)`,
        );

        await adapter.migrateToLatest();

        const [failedJob, cleanJob] = await adapter.getJobs({ jobIds: [failedJobId, cleanJobId] });
        expect(failedJob).toMatchObject({
          attempt: 3,
          consecutiveFailures: 1,
          lastAttemptError: "Error: boom",
          lastRescheduleReason: null,
        });
        expect(cleanJob).toMatchObject({
          attempt: 2,
          consecutiveFailures: 0,
          lastAttemptError: null,
          lastRescheduleReason: null,
        });
      },
    );
  });

  describe("parallel deployments", () => {
    it(
      "applies the schema exactly once when several deployments migrate at the same time",
      { timeout: 120_000 },
      async ({ database: { path, provider } }) => {
        const results = (await startTogether(
          Array.from({ length: 4 }, () => spawnDeployment(path, "older")),
        )) as MigrationResult[];

        expect(results.flatMap((result) => result.applied).toSorted()).toEqual(ALL);
        expect(results.map((result) => [...result.applied, ...result.skipped].toSorted())).toEqual(
          results.map(() => ALL),
        );
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
          { applied: [], skipped: ALL, reverted: [], unrecognized: [MARKER] },
        ]);
        expect(await appliedNames(provider)).toEqual([...ALL, MARKER]);
      },
    );
  });
});

// A synchronous migration cannot pause for the parent to kill it mid-transaction, so this runs
// only in the async mode.
itIn("async")(
  "rolls back the migration of a deployment killed mid-migration, and the next deployment applies it",
  { timeout: 120_000 },
  async ({ database: { path, provider } }) => {
    const spawnDeployment = spawnerIn("async");
    const killed = await startPaused(spawnDeployment(path, "older", "inside-migration"));
    await killed.kill();

    expect(
      await names(provider, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"),
    ).toEqual(["queuert_migration", "queuert_write_lock"]);
    expect(await startTogether([spawnDeployment(path, "older")])).toEqual([
      { applied: ALL, skipped: [], reverted: [], unrecognized: [] },
    ]);
    expect(await appliedNames(provider)).toEqual(ALL);
  },
);
