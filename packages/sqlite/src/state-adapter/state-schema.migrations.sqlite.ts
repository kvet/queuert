import { type MaybePromise, syncAsync, type Mode, step } from "@queuert/sync-async";
import {
  type Migration,
  type MigrationResult,
  type MigrationStore,
  type TemplateApplier,
  type TypedSqlTemplate,
  createMigrator,
  createTypedSqlExecutor,
  sql,
} from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

import { createSqliteMigrationStore } from "../migration-store/migration-store.sqlite.ts";
import type {
  ProviderMode,
  ProviderTxContext,
  SqliteStateProvider,
} from "../state-provider/state-provider.sqlite.ts";
import { schemaSnapshotStatements } from "./state-schema.sqlite.ts";

const SCHEMA_MIGRATION = "001_schema_v1";

type StatementExecutor<TTxContext, TResult> = (
  txCtx: TTxContext,
  statement: TypedSqlTemplate<readonly []>,
) => TResult;

const schemaNotRevertible = (): Error => new Error("The Queuert schema cannot be reverted.");

export function createSchemaMigrations<TTxContext>(
  execute: StatementExecutor<TTxContext, unknown>,
  mode: "sync",
): Migration<TTxContext, "sync">[];
export function createSchemaMigrations<TTxContext>(
  execute: StatementExecutor<TTxContext, Promise<unknown>>,
  mode: "async",
): Migration<TTxContext>[];
export function createSchemaMigrations<TTxContext>(
  execute: StatementExecutor<TTxContext, MaybePromise<unknown>>,
  mode: Mode,
): Migration<TTxContext, Mode>[];
export function createSchemaMigrations<TTxContext>(
  execute: StatementExecutor<TTxContext, MaybePromise<unknown>>,
  mode: Mode,
): Migration<TTxContext, Mode>[] {
  const upSchemaV1 = syncAsync(function* (txCtx: TTxContext) {
    for (const statement of [
      sql(/* sql */ `
CREATE TABLE {{table_prefix}}job (
  created_at                    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  scheduled_at                  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  completed_at                  TEXT,
  last_attempt_at               TEXT,
  attempt_at                    TEXT,
  chain_completed_at            TEXT,

  chain_index                   INTEGER NOT NULL,
  attempt                       INTEGER NOT NULL DEFAULT 0,

  id                            {{job_id_type}} PRIMARY KEY,
  chain_id                      {{job_id_type}} NOT NULL,
  continued_to_id               {{job_id_type}},

  status                        TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  chain_status                  TEXT
                                CHECK (chain_status IN ('running', 'completed')),
  type_name                     TEXT NOT NULL,
  completed_by                  TEXT,
  attempt_by                    TEXT,
  chain_deduplication_key       TEXT,
  chain_trace_context           TEXT,
  trace_context                 TEXT,
  last_attempt_error            TEXT,
  input                         TEXT,
  output                        TEXT,
  attempt_token                 TEXT
)`),
      sql(/* sql */ `
CREATE UNIQUE INDEX {{table_prefix}}chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)
WHERE chain_index > 0`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_deduplication_idx
ON {{table_prefix}}job (chain_deduplication_key, created_at DESC)
WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_idx
ON {{table_prefix}}job (type_name, created_at)`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_pending_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_blocked_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'blocked'`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_running_idx
ON {{table_prefix}}job (type_name, attempt_at)
WHERE status = 'running'`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_completed_idx
ON {{table_prefix}}job (type_name, completed_at)
WHERE status = 'completed'`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_attempt_by_idx
ON {{table_prefix}}job (attempt_by, attempt_at)
WHERE status = 'running'`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_idx
ON {{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_running_idx
ON {{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0 AND chain_status = 'running'`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_completed_idx
ON {{table_prefix}}job (type_name, chain_completed_at)
WHERE chain_index = 0 AND chain_status = 'completed'`),
      sql(/* sql */ `
CREATE TABLE {{table_prefix}}job_blocker (
  job_id                        {{job_id_type}} NOT NULL,
  blocked_by_chain_id           {{job_id_type}} NOT NULL,
  "index"                       INTEGER NOT NULL,
  trace_context                 TEXT,
  PRIMARY KEY (job_id, blocked_by_chain_id, "index")
)`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`),
      sql(/* sql */ `
CREATE TABLE {{table_prefix}}worker (
  started_at                    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  lease_until                   TEXT NOT NULL,
  token                         TEXT NOT NULL,
  concurrency                   INTEGER NOT NULL,
  id                            {{worker_id_type}} PRIMARY KEY,
  type_names                    TEXT NOT NULL
)`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}worker_idx
ON {{table_prefix}}worker (started_at)`),
      sql(/* sql */ `
CREATE TABLE {{table_prefix}}schema_fence_v1 (id INTEGER PRIMARY KEY)`),
    ]) {
      yield* step(execute(txCtx, statement));
    }
  });
  const upSchemaV2 = syncAsync(function* (txCtx: TTxContext) {
    for (const statement of [
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job
  ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0`),
      sql(/* sql */ `
UPDATE {{table_prefix}}job
SET blocking = 1
WHERE chain_index = 0
  AND id IN (SELECT blocked_by_chain_id FROM {{table_prefix}}job_blocker)`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_blocking_idx
ON {{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0 AND blocking = 1`),
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job ADD COLUMN last_reschedule_reason TEXT`),
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0`),
      sql(/* sql */ `
UPDATE {{table_prefix}}job
SET last_attempt_error = CASE WHEN json_valid(last_attempt_error) THEN json_extract(last_attempt_error, '$') ELSE last_attempt_error END,
  consecutive_failures = 1
WHERE last_attempt_error IS NOT NULL`),
      sql(/* sql */ `
CREATE TABLE {{table_prefix}}schema_fence_v2 (id INTEGER PRIMARY KEY)`),
      sql(/* sql */ `
DROP TABLE {{table_prefix}}schema_fence_v1`),
    ]) {
      yield* step(execute(txCtx, statement));
    }
  });
  const down =
    mode === "sync"
      ? () => {
          throw schemaNotRevertible();
        }
      : async () => {
          throw schemaNotRevertible();
        };
  return [
    { name: SCHEMA_MIGRATION, up: mode === "sync" ? upSchemaV1.sync : upSchemaV1.async, down },
    {
      name: "002_schema_v2",
      up: mode === "sync" ? upSchemaV2.sync : upSchemaV2.async,
      down,
    },
  ];
}

export function createMigrationStore<
  TStateProvider extends
    | SqliteStateProvider<any, "sync">
    | SqliteStateProvider<any>
    | SqliteStateProvider<any, Mode>,
>(
  stateProvider: TStateProvider,
  applyTemplate: TemplateApplier,
): MigrationStore<ProviderTxContext<TStateProvider>, ProviderMode<TStateProvider>>;
export function createMigrationStore<TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext, Mode>,
  applyTemplate: TemplateApplier,
): MigrationStore<TTxContext, Mode> {
  return createSqliteMigrationStore({
    stateProvider,
    migrationTable: applyTemplate(sql("{{migration_table}}")).sql,
    writeLockTable: applyTemplate(sql("{{write_lock_table}}")).sql,
    lease: false,
  });
}

export const migrateSchemaToLatest = <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext, Mode>,
  applyTemplate: TemplateApplier,
): MaybePromise<MigrationResult> => {
  const sync = stateProvider.sync === true;
  const migrate = syncAsync(function* () {
    const store = createMigrationStore(stateProvider, applyTemplate);
    const exec = createTypedSqlExecutor(stateProvider);
    const migrations = createSchemaMigrations(
      (txCtx: TTxContext, statement) => exec({ txCtx, sql: applyTemplate(statement) }),
      sync ? "sync" : "async",
    );
    const installed: string[] = [];
    const installLatestSchema = syncAsync(function* (txCtx: TTxContext) {
      if ((yield* step(store.getAppliedMigrationNames(txCtx))).length > 0) {
        return [];
      }
      for (const statement of schemaSnapshotStatements) {
        yield* step(exec({ txCtx, sql: applyTemplate(statement) }));
      }
      for (const { name } of migrations) {
        yield* step(store.recordMigration(txCtx, name));
      }
      return migrations.map(({ name }) => name);
    });
    const installIntoEmptyDatabase = syncAsync(function* () {
      installed.push(
        ...(yield* step(
          store.runInTransaction(sync ? installLatestSchema.sync : installLatestSchema.async),
        )),
      );
    });
    const migrator = createMigrator({
      mode: sync ? "sync" : "async",
      migrations,
      store,
      before: sync ? installIntoEmptyDatabase.sync : installIntoEmptyDatabase.async,
    });
    const result = yield* step(migrator.migrateToLatest());
    return {
      ...result,
      applied: [...installed, ...result.applied],
      skipped: result.skipped.filter((name) => !installed.includes(name)),
    };
  });
  return sync ? migrate.sync() : migrate.async();
};
