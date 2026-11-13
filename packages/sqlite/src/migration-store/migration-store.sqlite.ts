import { type Mode, andThen } from "@queuert/helpers/maybe-promise";
import { modal } from "@queuert/helpers/modal";
import { step } from "@queuert/helpers/steps";
import { assertMigrationLockOptions } from "@queuert/typed-sql/migration-lock";
import {
  type Migration,
  type MigrationScript,
  type MigrationStore,
  type Migrator,
  createModeMigrator,
} from "@queuert/typed-sql/migrator";
import { type TypedSqlTemplate, sql, t } from "@queuert/typed-sql/sql";
import { createTypedSqlExecutor, validateSqlIdentifier } from "@queuert/typed-sql/sql-executor";
import { createTemplateApplier } from "@queuert/typed-sql/template-applier";
import type { BaseTxContext } from "queuert";
import { isSyncAdapter } from "queuert/internal";

import type {
  ModeSqliteStateProvider,
  SqliteStateProvider,
  SyncSqliteStateProvider,
} from "../state-provider/state-provider.sqlite.ts";

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

type MigrationStoreOptions<TStateProvider> = {
  stateProvider: TStateProvider;
  migrationTable: string;
  writeLockTable: string;
  lease: boolean;
};

const createModeSqliteMigrationStore = <TTxContext extends BaseTxContext>({
  stateProvider,
  migrationTable,
  writeLockTable,
  lease,
}: MigrationStoreOptions<ModeSqliteStateProvider<TTxContext>>): MigrationStore<
  TTxContext,
  Mode
> => {
  const exec = createTypedSqlExecutor(stateProvider);

  const applyTemplate = createTemplateApplier({
    migration_table: migrationTable,
    write_lock_table: writeLockTable,
  });
  const createMigrationTableSql = applyTemplate(createMigrationTableStatement);
  const createWriteLockTableSql = applyTemplate(
    lease ? createLeaseTableStatement : createWriteLockTableStatement,
  );
  const takeWriteLockSql = applyTemplate(takeWriteLockStatement);
  const getAppliedMigrationsSql = applyTemplate(getAppliedMigrationsStatement);
  const recordMigrationSql = applyTemplate(recordMigrationStatement);
  const unrecordMigrationSql = applyTemplate(unrecordMigrationStatement);

  const initialize = modal(function* () {
    yield* step(exec({ sql: createMigrationTableSql }));
    yield* step(exec({ sql: createWriteLockTableSql }));
  });
  const sync = isSyncAdapter(stateProvider);

  return {
    initialize: sync ? initialize.sync : initialize.async,
    runInTransaction: (fn) =>
      stateProvider.withTransaction((txCtx) =>
        andThen(exec({ txCtx, sql: takeWriteLockSql }), () => fn(txCtx)),
      ),
    getAppliedMigrationNames: (txCtx) =>
      andThen(exec({ txCtx, sql: getAppliedMigrationsSql }), (applied) =>
        applied.map((m) => m.name),
      ),
    recordMigration: (txCtx, name) =>
      andThen(exec({ txCtx, sql: recordMigrationSql, params: [name] }), () => undefined),
    unrecordMigration: (txCtx, name) =>
      andThen(exec({ txCtx, sql: unrecordMigrationSql, params: [name] }), () => undefined),
  };
};

export const createSqliteMigrationStore: {
  <TTxContext extends BaseTxContext>(
    options: MigrationStoreOptions<SyncSqliteStateProvider<TTxContext>>,
  ): MigrationStore<TTxContext, "sync">;
  <TTxContext extends BaseTxContext>(
    options: MigrationStoreOptions<SqliteStateProvider<TTxContext>>,
  ): MigrationStore<TTxContext>;
  <TTxContext extends BaseTxContext>(
    options: MigrationStoreOptions<ModeSqliteStateProvider<TTxContext>>,
  ): MigrationStore<TTxContext, Mode>;
} = createModeSqliteMigrationStore as any;

const withMigrationLease = <TTxContext extends BaseTxContext>(
  store: MigrationStore<TTxContext, Mode>,
  {
    stateProvider,
    writeLockTable,
  }: { stateProvider: ModeSqliteStateProvider<TTxContext>; writeLockTable: string },
): MigrationStore<TTxContext, Mode> => {
  const exec = createTypedSqlExecutor(stateProvider);
  const applyTemplate = createTemplateApplier({ write_lock_table: writeLockTable });
  const acquireMigrationLockSql = applyTemplate(acquireMigrationLockStatement);
  const extendMigrationLockSql = applyTemplate(extendMigrationLockStatement);
  const releaseMigrationLockSql = applyTemplate(releaseMigrationLockStatement);
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

const createModeApplicationSqliteMigrationStore = <TTxContext extends BaseTxContext>({
  stateProvider,
  migrationTableName = "migration",
  lockTableName = "migration_lock",
}: {
  stateProvider: ModeSqliteStateProvider<TTxContext>;
  migrationTableName?: string;
  lockTableName?: string;
}): MigrationStore<TTxContext, Mode> => {
  validateSqlIdentifier(migrationTableName, "migrationTableName");
  validateSqlIdentifier(lockTableName, "lockTableName");

  const store = createModeSqliteMigrationStore({
    stateProvider,
    migrationTable: migrationTableName,
    writeLockTable: lockTableName,
    lease: true,
  });
  return isSyncAdapter(stateProvider)
    ? store
    : withMigrationLease(store, { stateProvider, writeLockTable: lockTableName });
};

type ApplicationMigrationStoreOptions<TStateProvider> = {
  stateProvider: TStateProvider;
  migrationTableName?: string;
  lockTableName?: string;
};

export const createApplicationSqliteMigrationStore: {
  <TTxContext extends BaseTxContext>(
    options: ApplicationMigrationStoreOptions<SyncSqliteStateProvider<TTxContext>>,
  ): MigrationStore<TTxContext, "sync">;
  <TTxContext extends BaseTxContext>(
    options: ApplicationMigrationStoreOptions<SqliteStateProvider<TTxContext>>,
  ): MigrationStore<TTxContext>;
  <TTxContext extends BaseTxContext>(
    options: ApplicationMigrationStoreOptions<ModeSqliteStateProvider<TTxContext>>,
  ): MigrationStore<TTxContext, Mode>;
} = createModeApplicationSqliteMigrationStore as any;

type SqliteMigratorTableOptions = {
  /** Table that records applied migrations. @defaultValue "migration" */
  migrationTableName?: string;
  /**
   * Table every migration transaction writes first, so it takes SQLite's write lock before it
   * reads the history; the migrator over a {@link SqliteStateProvider} also keeps its lease there.
   *
   * @defaultValue "migration_lock"
   */
  lockTableName?: string;
};

/**
 * Create a migrator for your application's own migrations, kept in SQLite through the state
 * provider you pass to the state adapter. The migrator follows the provider's mode.
 *
 * The migrator creates its history and lock tables on the first run, if they are missing. Each
 * migration transaction writes to the lock table first, so it takes SQLite's write lock before it
 * reads the history. Set the driver's busy timeout longer than your longest migration
 * transaction, or a waiting process fails with `SQLITE_BUSY` instead of waiting its turn.
 *
 * - Over a {@link SqliteStateProvider} it returns a {@link Migrator}. Every run claims a lease row
 *   in the lock table first, so processes migrating at once take turns: one migrates and extends
 *   the lease while it works, the others wait and then skip what it applied.
 * - Over a {@link SyncSqliteStateProvider} it takes synchronous migrations and returns a
 *   `Migrator<"sync">`, whose `migrateToLatest` and `migrateTo` return their results directly.
 *   It takes no lease: each transactional migration still takes SQLite's write lock before it
 *   reads the history, so processes migrating at once apply it once, but a non-transactional
 *   migration can run in two of them. Migrate from one process when you have those.
 *
 * Inside a `transactional` migration, run queries only through the `txCtx` that `up` and `down`
 * receive. An asynchronous provider holds its write lock for the whole transaction, so a query
 * through the outer client, or taking the provider's lock again, waits forever.
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
export const createSqliteMigrator: {
  <TTxContext extends BaseTxContext>(
    options: {
      /** The provider the migrator runs the migrations and keeps its history through. */
      stateProvider: SyncSqliteStateProvider<TTxContext>;
      /** The migrations, in the order they run. Append new migrations at the end. */
      migrations: Migration<NoInfer<TTxContext>, "sync">[];
      /** Runs on every run, before the history is read. Records nothing. */
      before?: MigrationScript<"sync">;
      /** Runs after the migrations have run, unless one failed. Records nothing. */
      after?: MigrationScript<"sync">;
    } & SqliteMigratorTableOptions,
  ): Migrator<"sync">;
  <TTxContext extends BaseTxContext>(
    options: {
      /** The provider the migrator runs the migrations and keeps its history through. */
      stateProvider: SqliteStateProvider<TTxContext>;
      /** The migrations, in the order they run. Append new migrations at the end. */
      migrations: Migration<NoInfer<TTxContext>>[];
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
    } & SqliteMigratorTableOptions,
  ): Migrator;
} = ({
  stateProvider,
  migrations,
  migrationTableName,
  lockTableName,
  lock,
  before,
  after,
}: {
  stateProvider: ModeSqliteStateProvider<any>;
  migrations: Migration<any, Mode>[];
  lock?: { ttlMs?: number; heartbeatIntervalMs?: number; pollIntervalMs?: number };
  before?: MigrationScript<Mode>;
  after?: MigrationScript<Mode>;
} & SqliteMigratorTableOptions): any => {
  assertMigrationLockOptions("createSqliteMigrator", lock);
  const store = createModeApplicationSqliteMigrationStore({
    stateProvider,
    migrationTableName,
    lockTableName,
  });
  return createModeMigrator({
    sync: isSyncAdapter(stateProvider),
    migrations,
    store,
    lock,
    before,
    after,
  });
};
