import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeploymentSpawner, startPaused, startTogether } from "@queuert/helpers/testing";
import type { MigrationResult } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import { createSqliteMigrator } from "../migration-store/migration-store.sqlite.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";
import { DEPLOYED_MIGRATIONS, DEPLOYMENT_NAMES, LEASE_TTL_MS, NEWER } from "./migrator.process.ts";

type Provider = SqliteStateProvider<BetterSqlite3Context>;

const spawnDeployment = createDeploymentSpawner<MigrationResult>(
  join(import.meta.dirname, "migrator.process.ts"),
  join(import.meta.dirname, "..", ".."),
);

const ALL = DEPLOYED_MIGRATIONS.map((migration) => migration.name);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const lockRows = async (provider: Provider): Promise<{ locked_by: string }[]> =>
  query(provider, "SELECT locked_by FROM migration_lock");

const deploymentRuns = async (provider: Provider): Promise<unknown[]> =>
  query(provider, "SELECT pid FROM deployment_runs");

const query = async <T>(provider: Provider, text: string): Promise<T[]> =>
  provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: { _: "string" },
    readOnly: true,
  }) as Promise<T[]>;

const execute = async (provider: Provider, text: string): Promise<void> => {
  await provider.executeSql({
    sql: text,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: false,
  });
};

const tableNames = async (provider: Provider): Promise<string[]> =>
  (
    await query<{ name: string }>(
      provider,
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
  ).map((row) => row.name);

const appliedNames = async (provider: Provider, table = "migration"): Promise<string[]> =>
  (await query<{ name: string }>(provider, `SELECT name FROM ${table} ORDER BY name`)).map(
    (row) => row.name,
  );

const result = (overrides: Partial<MigrationResult>): MigrationResult => ({
  applied: [],
  skipped: [],
  reverted: [],
  unrecognized: [],
  ...overrides,
});

// oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
const it = baseIt.extend("database", async ({}, { onCleanup }) => {
  const path = join(tmpdir(), `queuert-migration-store-${randomUUID()}.sqlite`);
  const db = new Database(path, { timeout: 30_000 });
  db.pragma("journal_mode = WAL");
  onCleanup(async () => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  });
  return { path, provider: createBetterSqlite3Provider({ db }) };
});

describe("createSqliteMigrator", () => {
  it("applies every migration type and reverts them all, last first", async ({
    database: { provider },
  }) => {
    const migrator = createSqliteMigrator({
      stateProvider: provider,
      migrations: [
        ...DEPLOYED_MIGRATIONS,
        {
          name: "seed_invoices",
          type: "non-transactional",
          up: async ({ assertLockHeld }) => {
            for (let id = 2; id <= 5; id++) {
              assertLockHeld();
              await execute(
                provider,
                `INSERT INTO invoices (id, customer) VALUES (${id}, 'customer-${id}')`,
              );
            }
          },
          down: async () => execute(provider, "DELETE FROM invoices WHERE id > 1"),
        },
        {
          name: "invoices_status_idx",
          type: "non-transactional",
          up: async () =>
            execute(provider, "CREATE INDEX invoices_status_idx ON invoices (status)"),
          down: async () => execute(provider, "DROP INDEX invoices_status_idx"),
        },
        {
          name: "backfill_invoice_status",
          type: "non-transactional",
          up: async ({ assertLockHeld }) => {
            while (
              (
                await query(
                  provider,
                  "UPDATE invoices SET status = 'open' WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 2) RETURNING id",
                )
              ).length > 0
            ) {
              assertLockHeld();
            }
          },
          down: async ({ assertLockHeld }) => {
            while (
              (
                await query(
                  provider,
                  "UPDATE invoices SET status = NULL WHERE id IN (SELECT id FROM invoices WHERE status IS NOT NULL LIMIT 2) RETURNING id",
                )
              ).length > 0
            ) {
              assertLockHeld();
            }
          },
        },
      ],
    });
    const names = [...ALL, "seed_invoices", "invoices_status_idx", "backfill_invoice_status"];

    expect(await migrator.migrateToLatest()).toEqual(result({ applied: names }));
    expect(await query(provider, "SELECT id, status FROM invoices ORDER BY id")).toEqual(
      [1, 2, 3, 4, 5].map((id) => ({ id, status: "open" })),
    );

    expect(await migrator.migrateTo(ALL[0])).toEqual(
      result({ skipped: [ALL[0]], reverted: names.slice(1).reverse() }),
    );
    expect(await query(provider, "SELECT id, status FROM invoices ORDER BY id")).toEqual([
      { id: 1, status: null },
    ]);
    expect(
      await query(
        provider,
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'invoices'",
      ),
    ).toEqual([]);
    expect(await appliedNames(provider)).toEqual([ALL[0]]);
  });

  it("adopts the history of Kysely's migrator through a `before` script", async ({
    database: { provider },
  }) => {
    for (const statement of [
      "CREATE TABLE kysely_migration (name varchar(255) NOT NULL PRIMARY KEY, timestamp varchar(255) NOT NULL)",
      "INSERT INTO kysely_migration VALUES ('create_invoices', '2026-01-01T00:00:00.000Z')",
      "CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, status TEXT)",
    ]) {
      await execute(provider, statement);
    }
    const migrator = createSqliteMigrator({
      stateProvider: provider,
      migrations: DEPLOYED_MIGRATIONS,
      before: async () =>
        execute(
          provider,
          "INSERT OR IGNORE INTO migration (name) SELECT name FROM kysely_migration",
        ),
    });

    expect(await migrator.migrateToLatest()).toEqual(
      result({ skipped: [ALL[0]], applied: ALL.slice(1) }),
    );
    expect(await migrator.migrateToLatest()).toEqual(result({ skipped: ALL }));
    expect(await appliedNames(provider)).toEqual(ALL.toSorted());
  });

  it("creates its tables under the configured names", async ({ database: { provider } }) => {
    await createSqliteMigrator({
      stateProvider: provider,
      migrations: [
        {
          name: "create_invoices",
          up: async (txCtx) => void txCtx.db.exec("SELECT 1"),
          down: async () => {},
        },
      ],
      migrationTableName: "schema_history",
      lockTableName: "schema_lock",
    }).migrateToLatest();

    expect(await tableNames(provider)).toEqual(["schema_history", "schema_lock"]);
    expect(
      await query(provider, "SELECT name, type FROM pragma_table_info('schema_history')"),
    ).toEqual([
      { name: "name", type: "TEXT" },
      { name: "applied_at", type: "TEXT" },
    ]);
    expect(await query(provider, "SELECT name FROM schema_history")).toEqual([
      { name: "create_invoices" },
    ]);
  });

  it("keeps its lease through a transactional migration that outlasts the lease TTL", async ({
    database: { provider },
  }) => {
    const result = await createSqliteMigrator({
      stateProvider: provider,
      lock: { ttlMs: 300, heartbeatIntervalMs: 50 },
      migrations: [
        {
          name: "create_invoices",
          up: async (txCtx) => {
            txCtx.db.exec("CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL)");
            await sleep(800);
          },
          down: async (txCtx) => void txCtx.db.exec("DROP TABLE invoices"),
        },
        {
          name: "seed_invoices",
          up: async (txCtx) =>
            void txCtx.db.exec("INSERT INTO invoices (id, customer) VALUES (1, 'customer-1')"),
          down: async (txCtx) => void txCtx.db.exec("DELETE FROM invoices"),
        },
      ],
    }).migrateToLatest();

    expect(result.applied).toEqual(["create_invoices", "seed_invoices"]);
    expect(await lockRows(provider)).toEqual([]);
  });

  it("rejects a name that is not a plain SQL identifier", () => {
    const stateProvider = undefined as unknown as Provider;
    for (const option of ["migrationTableName", "lockTableName"]) {
      expect(() =>
        createSqliteMigrator({
          stateProvider,
          migrations: [],
          [option]: "invoices; DROP TABLE invoices",
        }),
      ).toThrow(new RegExp(`Invalid ${option}`));
    }
  });

  it("rejects a lease heartbeat that is not below a third of the lease TTL", () => {
    expect(() =>
      createSqliteMigrator({
        stateProvider: undefined as unknown as Provider,
        migrations: [],
        lock: { ttlMs: 10_000, heartbeatIntervalMs: 5_000 },
      }),
    ).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: [
          "createSqliteMigrator: invalid configuration:",
          "  - lock.heartbeatIntervalMs must be below a third of lock.ttlMs (got 5000 and 10000)",
        ].join("\n"),
      }),
    );
  });
});

describe("parallel deployments", () => {
  it(
    "applies every migration exactly once when several deployments migrate at the same time",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const results = await startTogether(
        Array.from({ length: 4 }, () => spawnDeployment(path, "older")),
      );

      expect(
        results.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual([
        result({ skipped: DEPLOYMENT_NAMES }),
        result({ skipped: DEPLOYMENT_NAMES }),
        result({ skipped: DEPLOYMENT_NAMES }),
        result({ applied: DEPLOYMENT_NAMES }),
      ]);
      expect(await appliedNames(provider)).toEqual(DEPLOYMENT_NAMES.toSorted());
      expect(await deploymentRuns(provider)).toHaveLength(1);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "keeps the lease past its TTL while the holder is busy, and the waiter skips the holder's work",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const holder = await startPaused(spawnDeployment(path, "older", "before-migrating"));
      const waiter = spawnDeployment(path, "older");
      await waiter.waitFor("ready");
      waiter.go();

      await sleep(LEASE_TTL_MS * 2);
      expect(waiter.finished()).toBe(false);

      holder.go();
      expect(await holder.result()).toEqual(result({ applied: DEPLOYMENT_NAMES }));
      expect(await waiter.result()).toEqual(result({ skipped: DEPLOYMENT_NAMES }));
      expect(await deploymentRuns(provider)).toHaveLength(1);
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "rolls back the migration of a deployment killed mid-migration and takes over its lease once it expires",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const killed = await startPaused(spawnDeployment(path, "older", "inside-migration"));
      await killed.kill();

      expect(await tableNames(provider)).toEqual(["migration", "migration_lock"]);
      expect(await lockRows(provider)).toHaveLength(1);

      const startedAt = performance.now();
      expect(await startTogether([spawnDeployment(path, "older")])).toEqual([
        result({ applied: DEPLOYMENT_NAMES }),
      ]);
      expect(performance.now() - startedAt).toBeGreaterThan(LEASE_TTL_MS / 2);
      expect(await appliedNames(provider)).toEqual(DEPLOYMENT_NAMES.toSorted());
      expect(await lockRows(provider)).toEqual([]);
    },
  );

  it(
    "aborts a deployment frozen before migrating once it resumes after another deployment migrated in its place",
    { timeout: 120_000 },
    async ({ database: { path, provider } }) => {
      const frozen = await startPaused(spawnDeployment(path, "newer", "before-migrating"));
      frozen.freeze();
      await sleep(LEASE_TTL_MS + 500);

      expect(await startTogether([spawnDeployment(path, "older")])).toEqual([
        result({ applied: DEPLOYMENT_NAMES }),
      ]);

      frozen.thaw();
      frozen.go();
      expect(await frozen.result()).toEqual({
        error: expect.stringMatching(/Migration lock lost/),
      });
      expect(await appliedNames(provider)).toEqual(DEPLOYMENT_NAMES.toSorted());
      expect(await deploymentRuns(provider)).toHaveLength(1);
      expect(await lockRows(provider)).toEqual([]);
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

      expect([...older.applied, ...newer.applied].toSorted()).toEqual(
        [...DEPLOYMENT_NAMES, NEWER.name].toSorted(),
      );
      expect(newer.applied).toContain(NEWER.name);
      expect(await startTogether([spawnDeployment(path, "older")])).toEqual([
        result({ skipped: DEPLOYMENT_NAMES, unrecognized: [NEWER.name] }),
      ]);
      expect(await appliedNames(provider)).toEqual([...DEPLOYMENT_NAMES, NEWER.name].toSorted());
    },
  );
});
