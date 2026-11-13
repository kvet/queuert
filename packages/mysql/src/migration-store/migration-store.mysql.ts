import {
  type Migration,
  type MigrationScript,
  type MigrationStore,
  type Migrator,
  assertMigrationLockOptions,
  createMigrator,
  createTemplateApplier,
  createTypedSqlExecutor,
  sql,
  t,
  validateSqlIdentifier,
} from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

const createMigrationTableStatement = sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{migration_table}} (
  name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  applied_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE=InnoDB`);
const createMigrationLockTableStatement = sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{lock_table}} (
  id INT NOT NULL PRIMARY KEY,
  locked_by VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  locked_until DATETIME(6) NOT NULL
) ENGINE=InnoDB`);
const getAppliedMigrationsStatement = sql(
  /* sql */ `SELECT name FROM {{migration_table}} ORDER BY name`,
  { id: "getAppliedMigrations", params: [], columns: { name: t.string() }, readOnly: true },
);
const recordMigrationStatement = sql(
  /* sql */ `INSERT IGNORE INTO {{migration_table}} (name) VALUES (?)`,
  { id: "recordMigration", params: [t.string()], columns: {} },
);
const unrecordMigrationStatement = sql(/* sql */ `DELETE FROM {{migration_table}} WHERE name = ?`, {
  id: "unrecordMigration",
  params: [t.string()],
  columns: {},
});
const lockMigrationTableStatement = sql(
  /* sql */ `SELECT name FROM {{migration_table}} ORDER BY name FOR UPDATE`,
  { id: "lockMigrationTable", params: [], columns: { name: t.string() } },
);
const acquireMigrationLockStatement = sql(
  /* sql */ `
INSERT INTO {{lock_table}} (id, locked_by, locked_until)
VALUES (1, ?, UTC_TIMESTAMP(6) + INTERVAL ROUND(? * 1000) MICROSECOND)
ON DUPLICATE KEY UPDATE
  locked_by = IF(locked_until <= UTC_TIMESTAMP(6), VALUES(locked_by), locked_by),
  locked_until = IF(locked_until <= UTC_TIMESTAMP(6) OR locked_by = VALUES(locked_by), VALUES(locked_until), locked_until)`,
  { id: "acquireMigrationLock", params: [t.string(), t.number()], columns: {} },
);
const extendMigrationLockStatement = sql(
  /* sql */ `
UPDATE {{lock_table}}
SET locked_until = UTC_TIMESTAMP(6) + INTERVAL ROUND(? * 1000) MICROSECOND
WHERE id = 1 AND locked_by = ?`,
  { id: "extendMigrationLock", params: [t.number(), t.string()], columns: {} },
);
const readMigrationLockStatement = sql(
  /* sql */ `SELECT locked_by FROM {{lock_table}} WHERE id = 1`,
  { id: "readMigrationLock", params: [], columns: { locked_by: t.string() } },
);
const releaseMigrationLockStatement = sql(
  /* sql */ `DELETE FROM {{lock_table}} WHERE id = 1 AND locked_by = ?`,
  { id: "releaseMigrationLock", params: [t.string()], columns: {} },
);

export const createMysqlMigrationStore = <TTxContext extends BaseTxContext>({
  stateProvider,
  migrationTable,
  lockTable,
}: {
  stateProvider: MysqlStateProvider<TTxContext>;
  migrationTable: string;
  lockTable: string;
}): MigrationStore<TTxContext> => {
  const exec = createTypedSqlExecutor(stateProvider);
  const applyTemplate = createTemplateApplier({
    migration_table: migrationTable,
    lock_table: lockTable,
  });
  const createMigrationTableSql = applyTemplate(createMigrationTableStatement);
  const createMigrationLockTableSql = applyTemplate(createMigrationLockTableStatement);
  const getAppliedMigrationsSql = applyTemplate(getAppliedMigrationsStatement);
  const recordMigrationSql = applyTemplate(recordMigrationStatement);
  const unrecordMigrationSql = applyTemplate(unrecordMigrationStatement);
  const lockMigrationTableSql = applyTemplate(lockMigrationTableStatement);
  const acquireMigrationLockSql = applyTemplate(acquireMigrationLockStatement);
  const extendMigrationLockSql = applyTemplate(extendMigrationLockStatement);
  const readMigrationLockSql = applyTemplate(readMigrationLockStatement);
  const releaseMigrationLockSql = applyTemplate(releaseMigrationLockStatement);

  const holdsMigrationLock = async (ownerId: string): Promise<boolean> => {
    const [row] = await exec({ sql: readMigrationLockSql });
    return row?.locked_by === ownerId;
  };

  return {
    initialize: async () => {
      await exec({ sql: createMigrationTableSql });
      await exec({ sql: createMigrationLockTableSql });
    },
    runInTransaction: async (fn) =>
      stateProvider.withTransaction(async (txCtx) => {
        await exec({ txCtx, sql: lockMigrationTableSql });
        return fn(txCtx);
      }),
    getAppliedMigrationNames: async (txCtx) => {
      const applied = await exec({ txCtx, sql: getAppliedMigrationsSql });
      return applied.map((migration) => migration.name);
    },
    recordMigration: async (txCtx, name) => {
      await exec({ txCtx, sql: recordMigrationSql, params: [name] });
    },
    unrecordMigration: async (txCtx, name) => {
      await exec({ txCtx, sql: unrecordMigrationSql, params: [name] });
    },
    acquireMigrationLock: async (ownerId, ttlMs) => {
      await exec({ sql: acquireMigrationLockSql, params: [ownerId, ttlMs] });
      return holdsMigrationLock(ownerId);
    },
    extendMigrationLock: async (ownerId, ttlMs) => {
      await exec({ sql: extendMigrationLockSql, params: [ttlMs, ownerId] });
      return holdsMigrationLock(ownerId);
    },
    releaseMigrationLock: async (ownerId) => {
      await exec({ sql: releaseMigrationLockSql, params: [ownerId] });
    },
  };
};

export const createApplicationMysqlMigrationStore = <TTxContext extends BaseTxContext>({
  stateProvider,
  schema,
  migrationTableName = "migration",
  lockTableName = "migration_lock",
}: {
  stateProvider: MysqlStateProvider<TTxContext>;
  schema?: string;
  migrationTableName?: string;
  lockTableName?: string;
}): MigrationStore<TTxContext> => {
  if (schema !== undefined) validateSqlIdentifier(schema, "schema");
  validateSqlIdentifier(migrationTableName, "migrationTableName");
  validateSqlIdentifier(lockTableName, "lockTableName");
  const prefix = schema === undefined ? "" : `${schema}.`;

  return createMysqlMigrationStore({
    stateProvider,
    migrationTable: `${prefix}${migrationTableName}`,
    lockTable: `${prefix}${lockTableName}`,
  });
};

/**
 * Create a migrator for your application's own migrations, kept in MySQL or MariaDB through the
 * state provider you pass to the state adapter.
 *
 * The migrator creates its history and lease tables on the first run, if they are missing. Every
 * run claims a lease row first, so processes migrating at once take turns: one migrates and
 * extends the lease while it works, the others wait and then skip what it applied.
 *
 * DDL commits implicitly on both servers, so a migration that changes the schema is never atomic:
 * a failure after its first DDL statement leaves that statement applied and the migration
 * unrecorded. Write such statements to be rerunnable (`IF [NOT] EXISTS` on MariaDB), or split
 * them into one migration each.
 *
 * @experimental
 * @param options - Migrator configuration.
 * @throws Error if `schema` or a table name is not a plain SQL identifier, or if two migrations
 * share a name or a name is empty.
 * @throws TypeError if a `lock` timing is not a positive finite number, or `heartbeatIntervalMs` is
 * not below a third of `ttlMs`.
 *
 * @example
 * ```ts
 * const migrator = createMysqlMigrator({
 *   stateProvider,
 *   migrations: [
 *     {
 *       name: "create_invoices",
 *       up: async ({ connection }) => {
 *         await connection.query("CREATE TABLE invoices (id CHAR(36) PRIMARY KEY, total_cents INT NOT NULL)");
 *       },
 *       down: async ({ connection }) => {
 *         await connection.query("DROP TABLE invoices");
 *       },
 *     },
 *   ],
 * });
 * await migrator.migrateToLatest();
 * ```
 */
export const createMysqlMigrator = <TTxContext extends BaseTxContext>({
  stateProvider,
  migrations,
  lock,
  before,
  after,
  ...tables
}: {
  /** The provider the migrator keeps its history and lease through. */
  stateProvider: MysqlStateProvider<TTxContext>;
  /** The migrations, in the order they run. Append new migrations at the end. */
  migrations: Migration<NoInfer<TTxContext>>[];
  /** Database that holds the history and lease tables. @defaultValue the connection's database */
  schema?: string;
  /** Table that records applied migrations. @defaultValue "migration" */
  migrationTableName?: string;
  /** Table that holds the migration lease. @defaultValue "migration_lock" */
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
  assertMigrationLockOptions("createMysqlMigrator", lock);
  return createMigrator({
    migrations,
    store: createApplicationMysqlMigrationStore({ stateProvider, ...tables }),
    lock,
    before,
    after,
  });
};
