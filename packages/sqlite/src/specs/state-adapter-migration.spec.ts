import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import { type MigrationResult, createMigrator, createTemplateApplier } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";
import { withWorkers } from "queuert/testing";
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
import { MARKER } from "./state-adapter-migration.process.js";

const INSTALL = "001_initial_schema";
const WORKER_LIVENESS = "002_worker_liveness";
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

const migrateToInstall = async (provider: Provider): Promise<void> => {
  await createMigrator<BetterSqlite3Context>({
    migrations: migrations.filter((migration) => migration.name === INSTALL),
    store: createMigrationStore(
      provider,
      createTemplateApplier({ table_prefix: "queuert_", job_id_type: "TEXT" }),
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

const indexColumnNames = async (provider: Provider, indexName: string): Promise<string[]> =>
  (
    await query<{ name: string }>(
      provider,
      `SELECT name FROM pragma_index_info('${indexName}') ORDER BY seqno`,
    )
  ).map((row) => row.name);

const it = baseIt.extend<{
  database: {
    path: string;
    provider: Provider;
    adapter: Awaited<ReturnType<typeof createSqliteStateAdapter<BetterSqlite3Context, string>>>;
  };
}>({
  // oxlint-disable-next-line no-empty-pattern
  database: async ({}, use) => {
    const path = join(tmpdir(), `queuert-migration-${randomUUID()}.sqlite`);
    const db = new Database(path, { timeout: 30_000 });
    db.pragma("journal_mode = WAL");
    const provider = createBetterSqlite3Provider({ db });
    const adapter = await createSqliteStateAdapter({
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

  it(
    "upgrades a database with running jobs of the previous version, returning them to pending",
    { timeout: 60_000 },
    async ({ database: { provider, adapter } }) => {
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
      expect(await names(provider, "SELECT name FROM sqlite_master ORDER BY name")).toContain(
        "queuert_worker",
      );
      expect(await jobColumnNames(provider)).not.toContain("attempt_until");
      expect(await indexColumnNames(provider, "queuert_job_running_idx")).toEqual([
        "type_name",
        "attempt_at",
      ]);

      const [job] = await adapter.getJobs({ jobIds: [jobId] });
      expect(job!.status).toBe("pending");
      expect(job!.attempt).toBe(1);
      expect(job!.attemptAt).toBeNull();
      expect(job!.attemptBy).toBeNull();
      expect(job!.attemptToken).toBeNull();
    },
  );

  it(
    "reclaims a job a worker of the previous version claimed after the upgrade once its attempt is older than the lease",
    { timeout: 60_000 },
    async ({ database: { provider, adapter } }) => {
      await adapter.migrateToLatest();
      const staleJobId = randomUUID();
      const freshJobId = randomUUID();
      await execute(
        provider,
        `INSERT INTO queuert_job (id, type_name, chain_id, chain_index, status, chain_status, attempt, attempt_at, attempt_by)
         VALUES ('${staleJobId}', 'legacy', '${staleJobId}', 0, 'running', 'running', 1, datetime('now', 'subsec', '-1 hour'), 'legacy-worker'),
                ('${freshJobId}', 'legacy', '${freshJobId}', 0, 'running', 'running', 1, datetime('now', 'subsec'), 'legacy-worker')`,
      );
      const jobTypes = defineJobTypes<{ legacy: { entry: true; input: null; output: null } }>();
      const client = await createClient({ stateAdapter: adapter, jobTypes });
      const worker = await createInProcessWorker({
        client,
        pollIntervalMs: 20,
        leaseConfig: { durationMs: 60_000, heartbeatMs: 50 },
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            legacy: {
              attemptHandler: async ({ complete }) =>
                withTransactionHooks(async (transactionHooks) =>
                  provider.withTransaction(async (txCtx) =>
                    complete({ ...txCtx, transactionHooks, output: null }),
                  ),
                ),
            },
          },
        }),
      });

      await withWorkers([await worker.start()], async () => {
        await expect
          .poll(async () => (await adapter.getJobs({ jobIds: [staleJobId] }))[0]!.status)
          .toBe("completed");
      });

      const [stale, fresh] = await adapter.getJobs({ jobIds: [staleJobId, freshJobId] });
      expect(stale).toMatchObject({ status: "completed", attempt: 2 });
      expect(fresh).toMatchObject({ status: "running", attempt: 1, attemptToken: null });
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
