import {
  type Migration,
  type MigrationScript,
  type MigrationStore,
  type Migrator,
  type TypedSqlTemplate,
  assertMigrationLockOptions,
  createMigrator,
  createTemplateApplier,
  createTypedSqlExecutor,
  sql,
  t,
  validateSqlIdentifier,
} from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

const createMigrationTableStatement = sql(
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{migration_table}} (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
)`,
  { id: "createMigrationTable", params: [], columns: {} },
);
const createWriteLockTableStatement = sql(
  /* sql */ `CREATE TABLE IF NOT EXISTS {{write_lock_table}} (id INTEGER PRIMARY KEY)`,
  { id: "createWriteLockTable", params: [], columns: {} },
);
const createLeaseTableStatement = sql(
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{write_lock_table}} (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked_by TEXT NOT NULL,
  locked_until REAL NOT NULL
)`,
  { id: "createLeaseTable", params: [], columns: {} },
);
const acquireMigrationLockStatement = sql(
  /* sql */ `
INSERT INTO {{write_lock_table}} (id, locked_by, locked_until)
VALUES (1, ?, julianday('now') + ? / 86400000.0)
ON CONFLICT (id) DO UPDATE SET locked_by = excluded.locked_by, locked_until = excluded.locked_until
WHERE {{write_lock_table}}.locked_until <= julianday('now')
RETURNING 1 AS acquired`,
  {
    id: "acquireMigrationLock",
    params: [t.string(), t.number()],
    columns: { acquired: t.number() },
  },
);
const extendMigrationLockStatement = sql(
  /* sql */ `
UPDATE {{write_lock_table}}
SET locked_until = julianday('now') + ? / 86400000.0
WHERE id = 1 AND locked_by = ?
RETURNING 1 AS extended`,
  {
    id: "extendMigrationLock",
    params: [t.number(), t.string()],
    columns: { extended: t.number() },
  },
);
const releaseMigrationLockStatement = sql(
  /* sql */ `DELETE FROM {{write_lock_table}} WHERE id = 1 AND locked_by = ?`,
  { id: "releaseMigrationLock", params: [t.string()], columns: {} },
);
export const takeWriteLockStatement: TypedSqlTemplate<readonly [], Record<string, never>> = sql(
  /* sql */ `UPDATE {{write_lock_table}} SET id = id WHERE 0`,
  {
    id: "takeWriteLock",
    params: [],
    columns: {},
  },
);
const getAppliedMigrationsStatement = sql(
  /* sql */ `SELECT name FROM {{migration_table}} ORDER BY name`,
  { id: "getAppliedMigrations", params: [], columns: { name: t.string() }, readOnly: true },
);
const recordMigrationStatement = sql(
  /* sql */ `INSERT INTO {{migration_table}} (name) VALUES (?) ON CONFLICT (name) DO NOTHING`,
  { id: "recordMigration", params: [t.string()], columns: {} },
);
const unrecordMigrationStatement = sql(/* sql */ `DELETE FROM {{migration_table}} WHERE name = ?`, {
  id: "unrecordMigration",
  params: [t.string()],
  columns: {},
});

export const createSqliteMigrationStore = <TTxContext extends BaseTxContext>({
  stateProvider,
  migrationTable,
  writeLockTable,
  lease,
}: {
  stateProvider: SqliteStateProvider<TTxContext>;
  migrationTable: string;
  writeLockTable: string;
  lease: boolean;
}): MigrationStore<TTxContext> => {
  const exec = createTypedSqlExecutor(stateProvider);

  const applyTemplate = createTemplateApplier({
    migration_table: migrationTable,
    write_lock_table: writeLockTable,
  });
  const createMigrationTableSql = applyTemplate(createMigrationTableStatement);
  const createWriteLockTableSql = applyTemplate(
    lease ? createLeaseTableStatement : createWriteLockTableStatement,
  );
  const acquireMigrationLockSql = applyTemplate(acquireMigrationLockStatement);
  const extendMigrationLockSql = applyTemplate(extendMigrationLockStatement);
  const releaseMigrationLockSql = applyTemplate(releaseMigrationLockStatement);
  const takeWriteLockSql = applyTemplate(takeWriteLockStatement);
  const getAppliedMigrationsSql = applyTemplate(getAppliedMigrationsStatement);
  const recordMigrationSql = applyTemplate(recordMigrationStatement);
  const unrecordMigrationSql = applyTemplate(unrecordMigrationStatement);

  const store: MigrationStore<TTxContext> = {
    initialize: async () => {
      await exec({ sql: createMigrationTableSql });
      await exec({ sql: createWriteLockTableSql });
    },
    runInTransaction: async (fn) =>
      stateProvider.withTransaction(async (txCtx) => {
        await exec({ txCtx, sql: takeWriteLockSql });
        return fn(txCtx);
      }),
    getAppliedMigrationNames: async (txCtx) => {
      const applied = await exec({ txCtx, sql: getAppliedMigrationsSql });
      return applied.map((m) => m.name);
    },
    recordMigration: async (txCtx, name) => {
      await exec({ txCtx, sql: recordMigrationSql, params: [name] });
    },
    unrecordMigration: async (txCtx, name) => {
      await exec({ txCtx, sql: unrecordMigrationSql, params: [name] });
    },
  };
  if (!lease) {
    return store;
  }
  return {
    ...store,
    acquireMigrationLock: async (ownerId, ttlMs) => {
      const rows = await exec({ sql: acquireMigrationLockSql, params: [ownerId, ttlMs] });
      return rows.length > 0;
    },
    extendMigrationLock: async (ownerId, ttlMs) => {
      const rows = await exec({ sql: extendMigrationLockSql, params: [ttlMs, ownerId] });
      return rows.length > 0;
    },
    releaseMigrationLock: async (ownerId) => {
      await exec({ sql: releaseMigrationLockSql, params: [ownerId] });
    },
  };
};

export const createApplicationSqliteMigrationStore = <TTxContext extends BaseTxContext>({
  stateProvider,
  migrationTableName = "migration",
  lockTableName = "migration_lock",
}: {
  stateProvider: SqliteStateProvider<TTxContext>;
  migrationTableName?: string;
  lockTableName?: string;
}): MigrationStore<TTxContext> => {
  validateSqlIdentifier(migrationTableName, "migrationTableName");
  validateSqlIdentifier(lockTableName, "lockTableName");

  return createSqliteMigrationStore({
    stateProvider,
    migrationTable: migrationTableName,
    writeLockTable: lockTableName,
    lease: true,
  });
};

/**
 * Create a migrator for your application's own migrations, kept in SQLite through the state
 * provider you pass to the state adapter.
 *
 * The migrator creates its history and lock tables on the first run, if they are missing. Every
 * run claims a lease row in the lock table first, so processes migrating at once take turns: one
 * migrates and extends the lease while it works, the others wait and then skip what it applied.
 * Each migration transaction also writes to the lock table first, so it takes SQLite's write lock
 * before it reads the history. Set the driver's busy timeout longer than your longest migration
 * transaction, or a waiting process fails with `SQLITE_BUSY` instead of waiting its turn.
 *
 * Inside a `transactional` migration, run queries only through the `txCtx` that `up` and `down`
 * receive. The provider holds its write lock for the whole transaction, so a query through the
 * outer client, or taking the provider's lock again, waits forever.
 *
 * @experimental
 * @param options - Migrator configuration.
 * @throws Error if a table name is not a plain SQL identifier, or if two migrations share a name or
 * a name is empty.
 * @throws TypeError if a `lock` timing is not a positive finite number, or `heartbeatIntervalMs` is
 * not below a third of `ttlMs`.
 *
 * @example
 * ```ts
 * const migrator = createSqliteMigrator({
 *   stateProvider,
 *   migrations: [
 *     {
 *       name: "create_invoices",
 *       up: async ({ db }) => {
 *         db.exec("CREATE TABLE invoices (id TEXT PRIMARY KEY, total_cents INTEGER NOT NULL)");
 *       },
 *       down: async ({ db }) => {
 *         db.exec("DROP TABLE invoices");
 *       },
 *     },
 *   ],
 * });
 * await migrator.migrateToLatest();
 * ```
 */
export const createSqliteMigrator = <TTxContext extends BaseTxContext>({
  stateProvider,
  migrations,
  lock,
  before,
  after,
  ...tables
}: {
  /** The provider the migrator keeps its history and lease through. */
  stateProvider: SqliteStateProvider<TTxContext>;
  /** The migrations, in the order they run. Append new migrations at the end. */
  migrations: Migration<NoInfer<TTxContext>>[];
  /** Table that records applied migrations. @defaultValue "migration" */
  migrationTableName?: string;
  /** Table that holds the migration lease, written first by every migration transaction. @defaultValue "migration_lock" */
  lockTableName?: string;
  /** Timing of the lease. */
  lock?: {
    /** How long a claimed lease stays valid without a heartbeat. @defaultValue 60s */
    ttlMs?: number;
    /**
     * How often the lease is extended while migrating. Below a third of `ttlMs`.
     *
     * @defaultValue the lower of 15s and a quarter of `ttlMs`
     */
    heartbeatIntervalMs?: number;
    /** How often a waiting process re-attempts to claim the lease. @defaultValue 1s */
    pollIntervalMs?: number;
  };
  /** Runs under the lease on every run, before the history is read. Records nothing. */
  before?: MigrationScript;
  /** Runs under the lease after the migrations have run, unless one failed. Records nothing. */
  after?: MigrationScript;
}): Migrator => {
  assertMigrationLockOptions("createSqliteMigrator", lock);
  return createMigrator({
    migrations,
    store: createApplicationSqliteMigrationStore({ stateProvider, ...tables }),
    lock,
    before,
    after,
  });
};
