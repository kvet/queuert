import {
  type MaybePromise,
  type ModeResult,
  syncAsync,
  type Mode,
  step,
} from "@queuert/sync-async";
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

import type {
  ProviderMode,
  ProviderTxContext,
  SqliteStateProvider,
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

export function createSqliteMigrationStore<TTxContext extends BaseTxContext>({
  stateProvider,
  migrationTable,
  writeLockTable,
  lease,
}: MigrationStoreOptions<SqliteStateProvider<TTxContext, Mode>>): MigrationStore<TTxContext, Mode> {
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

  const initialize = syncAsync(function* () {
    yield* step(exec({ sql: createMigrationTableSql }));
    yield* step(exec({ sql: createWriteLockTableSql }));
  });
  const runLocked = syncAsync(function* (
    txCtx: TTxContext,
    fn: (txCtx: TTxContext) => MaybePromise<unknown>,
  ) {
    yield* step(exec({ txCtx, sql: takeWriteLockSql }));
    return yield* step(fn(txCtx));
  });
  const getAppliedMigrationNames = syncAsync(function* (txCtx: TTxContext | undefined) {
    const applied = yield* step(exec({ txCtx, sql: getAppliedMigrationsSql }));
    return applied.map((m) => m.name);
  });
  const recordMigration = syncAsync(function* (txCtx: TTxContext | undefined, name: string) {
    yield* step(exec({ txCtx, sql: recordMigrationSql, params: [name] }));
  });
  const unrecordMigration = syncAsync(function* (txCtx: TTxContext | undefined, name: string) {
    yield* step(exec({ txCtx, sql: unrecordMigrationSql, params: [name] }));
  });
  const sync = stateProvider.sync === true;

  return {
    initialize: sync ? initialize.sync : initialize.async,
    runInTransaction: <T>(fn: (txCtx: TTxContext) => ModeResult<Mode, T>) =>
      stateProvider.withTransaction(
        (txCtx) =>
          (sync ? runLocked.sync(txCtx, fn) : runLocked.async(txCtx, fn)) as ModeResult<Mode, T>,
      ),
    getAppliedMigrationNames: sync ? getAppliedMigrationNames.sync : getAppliedMigrationNames.async,
    recordMigration: sync ? recordMigration.sync : recordMigration.async,
    unrecordMigration: sync ? unrecordMigration.sync : unrecordMigration.async,
  };
}

const withMigrationLease = <TTxContext extends BaseTxContext>(
  store: MigrationStore<TTxContext, Mode>,
  {
    stateProvider,
    writeLockTable,
  }: { stateProvider: SqliteStateProvider<TTxContext, Mode>; writeLockTable: string },
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

export function createSqliteMigratorStore<TTxContext extends BaseTxContext>({
  stateProvider,
  migrationTableName = "migration",
  lockTableName = "migration_lock",
}: {
  stateProvider: SqliteStateProvider<TTxContext, Mode>;
  migrationTableName?: string;
  lockTableName?: string;
}): MigrationStore<TTxContext, Mode> {
  validateSqlIdentifier(migrationTableName, "migrationTableName");
  validateSqlIdentifier(lockTableName, "lockTableName");

  const store = createSqliteMigrationStore({
    stateProvider,
    migrationTable: migrationTableName,
    writeLockTable: lockTableName,
    lease: true,
  });
  return stateProvider.sync === true
    ? store
    : withMigrationLease(store, { stateProvider, writeLockTable: lockTableName });
}

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

type SqliteMigratorOptions<
  TStateProvider extends
    | SqliteStateProvider<any, "sync">
    | SqliteStateProvider<any>
    | SqliteStateProvider<any, Mode>,
> = {
  /** The provider the migrator runs the migrations and keeps its history through. */
  stateProvider: TStateProvider;
  /** The migrations, in the order they run. Append new migrations at the end. */
  migrations: Migration<
    NoInfer<ProviderTxContext<TStateProvider>>,
    NoInfer<ProviderMode<TStateProvider>>
  >[];
  /** Timing of the lease. A synchronous provider takes no lease. */
  lock?: ProviderMode<TStateProvider> extends "sync"
    ? never
    : {
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
  /** Runs on every run, under the lease if there is one, before the history is read. Records nothing. */
  before?: MigrationScript<NoInfer<ProviderMode<TStateProvider>>>;
  /** Runs after the migrations have run, under the lease if there is one, unless one failed. Records nothing. */
  after?: MigrationScript<NoInfer<ProviderMode<TStateProvider>>>;
} & SqliteMigratorTableOptions;

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
 * - Over a {@link SqliteStateProvider} with `sync: true` it takes synchronous migrations and returns a
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
 *       up: ({ db }) => {
 *         db.exec("CREATE TABLE invoices (id TEXT PRIMARY KEY, total_cents INTEGER NOT NULL)");
 *       },
 *       down: ({ db }) => {
 *         db.exec("DROP TABLE invoices");
 *       },
 *     },
 *   ],
 * });
 * migrator.migrateToLatest();
 * ```
 */
export function createSqliteMigrator<
  TStateProvider extends
    | SqliteStateProvider<any, "sync">
    | SqliteStateProvider<any>
    | SqliteStateProvider<any, Mode>,
>(options: SqliteMigratorOptions<TStateProvider>): Migrator<ProviderMode<TStateProvider>>;
export function createSqliteMigrator({
  stateProvider,
  migrations,
  migrationTableName,
  lockTableName,
  lock,
  before,
  after,
}: SqliteMigratorOptions<SqliteStateProvider<any, Mode>>): Migrator<Mode> {
  assertMigrationLockOptions("createSqliteMigrator", lock);
  const store = createSqliteMigratorStore({
    stateProvider,
    migrationTableName,
    lockTableName,
  });
  return createMigrator({
    mode: stateProvider.sync === true ? "sync" : "async",
    migrations,
    store,
    lock,
    before,
    after,
  });
}
