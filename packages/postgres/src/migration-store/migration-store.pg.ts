import { assertMigrationLockOptions } from "@queuert/typed-sql/migration-lock";
import {
  type Migration,
  type MigrationScript,
  type MigrationStore,
  type Migrator,
  createMigrator,
} from "@queuert/typed-sql/migrator";
import { sql, t } from "@queuert/typed-sql/sql";
import { createTypedSqlExecutor, validateSqlIdentifier } from "@queuert/typed-sql/sql-executor";
import { createTemplateApplier } from "@queuert/typed-sql/template-applier";
import type { BaseTxContext } from "queuert";

import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

const createMigrationTableStatement = sql(
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{migration_table}} (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  { id: "createMigrationTable", params: [], columns: {} },
);
const findMigrationObjectsStatement = sql(
  /* sql */ `SELECT to_regnamespace('{{schema}}') IS NOT NULL AS schema_exists, to_regclass('{{migration_table}}') IS NOT NULL AS migration_table_exists, to_regclass('{{lock_table}}') IS NOT NULL AS lock_table_exists`,
  {
    id: "findMigrationObjects",
    params: [],
    columns: {
      schema_exists: t.boolean(),
      migration_table_exists: t.boolean(),
      lock_table_exists: t.boolean(),
    },
    readOnly: true,
  },
);
const createSchemaStatement = sql(/* sql */ `CREATE SCHEMA IF NOT EXISTS {{schema}}`, {
  id: "createMigrationSchema",
  params: [],
  columns: {},
});
const getAppliedMigrationsStatement = sql(
  /* sql */ `SELECT name FROM {{migration_table}} ORDER BY name`,
  { id: "getAppliedMigrations", params: [], columns: { name: t.string() }, readOnly: true },
);
const recordMigrationStatement = sql(
  /* sql */ `INSERT INTO {{migration_table}} (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
  { id: "recordMigration", params: [t.string()], columns: {} },
);
const unrecordMigrationStatement = sql(
  /* sql */ `DELETE FROM {{migration_table}} WHERE name = $1`,
  { id: "unrecordMigration", params: [t.string()], columns: {} },
);
const serializeMigrationTransactionStatement = sql(
  /* sql */ `DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('{{lock_table}}'), 0); END $$`,
  { id: "serializeMigrationTransaction", params: [], columns: {}, readOnly: true },
);
const createMigrationLockTableStatement = sql(
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{lock_table}} (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked_by TEXT NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL
)`,
  { id: "createMigrationLockTable", params: [], columns: {} },
);
const acquireMigrationLockStatement = sql(
  /* sql */ `
INSERT INTO {{lock_table}} AS l (id, locked_by, locked_until)
VALUES (1, $1, now() + ($2::double precision * interval '1 millisecond'))
ON CONFLICT (id) DO UPDATE SET locked_by = EXCLUDED.locked_by, locked_until = EXCLUDED.locked_until
WHERE l.locked_until <= now()
RETURNING 1 AS acquired`,
  {
    id: "acquireMigrationLock",
    params: [t.string(), t.number()],
    columns: { acquired: t.number() },
  },
);
const extendMigrationLockStatement = sql(
  /* sql */ `
UPDATE {{lock_table}}
SET locked_until = now() + ($2::double precision * interval '1 millisecond')
WHERE id = 1 AND locked_by = $1
RETURNING 1 AS extended`,
  {
    id: "extendMigrationLock",
    params: [t.string(), t.number()],
    columns: { extended: t.number() },
  },
);
const releaseMigrationLockStatement = sql(
  /* sql */ `DELETE FROM {{lock_table}} WHERE id = 1 AND locked_by = $1`,
  { id: "releaseMigrationLock", params: [t.string()], columns: {} },
);

export const createPgMigrationStore = <TTxContext extends BaseTxContext>({
  stateProvider,
  schema,
  createSchema,
  migrationTable,
  lockTable,
}: {
  stateProvider: PgStateProvider<TTxContext>;
  schema: string;
  createSchema: boolean;
  migrationTable: string;
  lockTable: string;
}): MigrationStore<TTxContext> => {
  const exec = createTypedSqlExecutor(stateProvider);

  const applyTemplate = createTemplateApplier({
    schema,
    migration_table: migrationTable,
    lock_table: lockTable,
  });
  const createMigrationTableSql = applyTemplate(createMigrationTableStatement);
  const findMigrationObjectsSql = applyTemplate(findMigrationObjectsStatement);
  const createSchemaSql = applyTemplate(createSchemaStatement);
  const getAppliedMigrationsSql = applyTemplate(getAppliedMigrationsStatement);
  const recordMigrationSql = applyTemplate(recordMigrationStatement);
  const unrecordMigrationSql = applyTemplate(unrecordMigrationStatement);
  const serializeMigrationTransactionSql = applyTemplate(serializeMigrationTransactionStatement);
  const createMigrationLockTableSql = applyTemplate(createMigrationLockTableStatement);
  const acquireMigrationLockSql = applyTemplate(acquireMigrationLockStatement);
  const extendMigrationLockSql = applyTemplate(extendMigrationLockStatement);
  const releaseMigrationLockSql = applyTemplate(releaseMigrationLockStatement);

  return {
    initialize: async () => {
      const [existing] = await exec({ sql: findMigrationObjectsSql });
      if (existing.migration_table_exists && existing.lock_table_exists) {
        return;
      }
      await stateProvider.withTransaction(async (txCtx) => {
        await exec({ txCtx, sql: serializeMigrationTransactionSql });
        const [found] = await exec({ txCtx, sql: findMigrationObjectsSql });
        if (createSchema && !found.schema_exists) {
          await exec({ txCtx, sql: createSchemaSql });
        }
        if (!found.migration_table_exists) {
          await exec({ txCtx, sql: createMigrationTableSql });
        }
        if (!found.lock_table_exists) {
          await exec({ txCtx, sql: createMigrationLockTableSql });
        }
      });
    },
    runInTransaction: async (fn) =>
      stateProvider.withTransaction(async (txCtx) => {
        await exec({ txCtx, sql: serializeMigrationTransactionSql });
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
    acquireMigrationLock: async (ownerId, ttlMs) => {
      const rows = await exec({ sql: acquireMigrationLockSql, params: [ownerId, ttlMs] });
      return rows.length > 0;
    },
    extendMigrationLock: async (ownerId, ttlMs) => {
      const rows = await exec({ sql: extendMigrationLockSql, params: [ownerId, ttlMs] });
      return rows.length > 0;
    },
    releaseMigrationLock: async (ownerId) => {
      await exec({ sql: releaseMigrationLockSql, params: [ownerId] });
    },
  };
};

export const createApplicationPgMigrationStore = <TTxContext extends BaseTxContext>({
  stateProvider,
  schema = "public",
  migrationTableName = "migration",
  lockTableName = "migration_lock",
}: {
  stateProvider: PgStateProvider<TTxContext>;
  schema?: string;
  migrationTableName?: string;
  lockTableName?: string;
}): MigrationStore<TTxContext> => {
  validateSqlIdentifier(schema, "schema");
  validateSqlIdentifier(migrationTableName, "migrationTableName");
  validateSqlIdentifier(lockTableName, "lockTableName");

  return createPgMigrationStore({
    stateProvider,
    schema,
    createSchema: true,
    migrationTable: `${schema}.${migrationTableName}`,
    lockTable: `${schema}.${lockTableName}`,
  });
};

/**
 * Create a migrator for your application's own migrations, kept in PostgreSQL through the state
 * provider you pass to the state adapter.
 *
 * The migrator creates its schema, history table and lease table on the first run, if they are
 * missing. Every run claims a lease row first, so processes migrating at once take turns: one
 * migrates and extends the lease while it works, the others wait and then skip what it applied.
 * Migration transactions also serialize on an advisory lock keyed on the lease table's qualified
 * name.
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
 * const migrator = createPgMigrator({
 *   stateProvider,
 *   migrations: [
 *     {
 *       name: "create_invoices",
 *       up: async ({ txSql }) => {
 *         await txSql`CREATE TABLE invoices (id uuid PRIMARY KEY, total_cents integer NOT NULL)`;
 *       },
 *       down: async ({ txSql }) => {
 *         await txSql`DROP TABLE invoices`;
 *       },
 *     },
 *   ],
 * });
 * await migrator.migrateToLatest();
 * ```
 */
export const createPgMigrator = <TTxContext extends BaseTxContext>({
  stateProvider,
  migrations,
  lock,
  before,
  after,
  ...tables
}: {
  /** The provider the migrator keeps its history and lease through. */
  stateProvider: PgStateProvider<TTxContext>;
  /** The migrations, in the order they run. Append new migrations at the end. */
  migrations: Migration<NoInfer<TTxContext>>[];
  /** Schema of the history and lease tables, created if missing. @defaultValue "public" */
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
  assertMigrationLockOptions("createPgMigrator", lock);
  return createMigrator({
    migrations,
    store: createApplicationPgMigrationStore({ stateProvider, ...tables }),
    lock,
    before,
    after,
  });
};
