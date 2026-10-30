import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMigrator, createTemplateApplier } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import {
  createMigrationStore,
  createSqliteStateAdapter,
  migrations,
} from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";
import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

const INSTALL = "001_initial_schema";
const WORKER_LIVENESS = "002_worker_liveness";
const ALL = [INSTALL, WORKER_LIVENESS];

type Provider = SqliteStateProvider<BetterSqlite3Context>;
type Db = {
  provider: Provider;
  adapter: Awaited<ReturnType<typeof createSqliteStateAdapter<BetterSqlite3Context, string>>>;
};

const ROW_RESULT: Record<string, "string"> = { _: "string" };
const query = async <T = Record<string, unknown>>(provider: Provider, sql: string): Promise<T[]> =>
  provider.executeSql({
    sql,
    params: [],
    paramTypes: {},
    columnTypes: ROW_RESULT,
    readOnly: true,
  }) as Promise<T[]>;

const it = baseIt.extend<{ fresh: Db }>({
  // oxlint-disable-next-line no-empty-pattern
  fresh: async ({}, use) => {
    const path = join(tmpdir(), `queuert-migration-${randomUUID()}.sqlite`);
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    const provider = createBetterSqlite3Provider({ db });
    const adapter = await createSqliteStateAdapter({
      stateProvider: provider,
      generateId: (): string => randomUUID(),
    });
    await use({ provider, adapter });
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  },
});

const execute = async (provider: Provider, sql: string): Promise<void> => {
  await provider.executeSql({ sql, params: [], paramTypes: {}, columnTypes: {}, readOnly: false });
};

const migrateToInstall = async (provider: Provider): Promise<void> => {
  await createMigrator<BetterSqlite3Context>({
    migrations: migrations.filter((migration) => migration.name === INSTALL),
    store: createMigrationStore(
      provider,
      createTemplateApplier({ table_prefix: "queuert_", id_type: "TEXT" }),
    ),
  }).migrateToLatest();
};

const jobColumnNames = async (provider: Provider): Promise<string[]> =>
  (await query<{ name: string }>(provider, "SELECT name FROM pragma_table_info('queuert_job')"))
    .map((row) => row.name)
    .sort();

const workerColumns = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ name: string; type: string; notnull: number }>(
      provider,
      "SELECT name, type, \"notnull\" FROM pragma_table_info('queuert_worker') ORDER BY name",
    )
  ).map((row) => `${row.name} ${row.type}${row.notnull === 1 ? " NOT NULL" : ""}`);

const objectNames = async (provider: Provider): Promise<string[]> =>
  (await query<{ name: string }>(provider, "SELECT name FROM sqlite_master ORDER BY name")).map(
    (row) => row.name,
  );

describe("migrateToLatest", () => {
  it(
    "installs the schema on an empty database",
    { timeout: 60_000 },
    async ({ fresh: { provider, adapter } }) => {
      expect(await adapter.migrateToLatest()).toEqual({
        applied: ALL,
        skipped: [],
        unrecognized: [],
      });
      expect(await objectNames(provider)).toEqual([
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
        "queuert_worker",
        "sqlite_autoindex_queuert_job_1",
        "sqlite_autoindex_queuert_job_blocker_1",
        "sqlite_autoindex_queuert_migration_1",
        "sqlite_autoindex_queuert_worker_1",
      ]);
      expect(await jobColumnNames(provider)).not.toContain("attempt_until");
      expect(await workerColumns(provider)).toEqual([
        "concurrency INTEGER NOT NULL",
        "id TEXT",
        "lease_until TEXT NOT NULL",
        "name TEXT",
        "started_at TEXT NOT NULL",
        "type_names TEXT NOT NULL",
      ]);
    },
  );

  it("is a no-op on a second run", { timeout: 60_000 }, async ({ fresh: { adapter } }) => {
    await adapter.migrateToLatest();
    expect(await adapter.migrateToLatest()).toEqual({
      applied: [],
      skipped: ALL,
      unrecognized: [],
    });
  });

  it(
    "upgrades a database with running jobs of the previous version, which reclaim returns to pending",
    { timeout: 60_000 },
    async ({ fresh: { provider, adapter } }) => {
      await migrateToInstall(provider);
      const jobId = randomUUID();
      await execute(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, attempt_at, attempt_by, attempt_until)
         VALUES ('${jobId}', 'legacy', '${jobId}', 0, 'running', 'running', 1, datetime('now', 'subsec'), 'legacy-worker', datetime('now', 'subsec', '+60 seconds'))`,
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
