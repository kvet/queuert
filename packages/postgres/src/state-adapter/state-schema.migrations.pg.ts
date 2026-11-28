import {
  type Migration,
  type MigrationResult,
  type MigrationStore,
  type TemplateApplier,
  type TypedSqlTemplate,
  createMigrator,
  createTypedSqlExecutor,
  sql,
  t,
} from "@queuert/typed-sql";
import type { BaseTxContext, RetryConfig } from "queuert";
import { withRetry } from "queuert/internal";

import { createPgMigrationStore } from "../migration-store/migration-store.pg.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";
import { createSchemaSnapshot } from "./state-schema.pg.ts";

const SCHEMA_MIGRATION = "001_schema_v1";

const LOCK_RETRY: RetryConfig = { maxTries: 20, initialDelayMs: 50, maxDelayMs: 1000 };

export const createSchemaMigrations = <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
): Migration<TTxContext>[] => {
  const exec = createTypedSqlExecutor(stateProvider);
  const execute = async (txCtx: TTxContext | undefined, statement: TypedSqlTemplate<readonly []>) =>
    exec({ txCtx, sql: applyTemplate(statement) });
  const isLockConflict = (error: unknown): boolean => {
    const kind = stateProvider.classifyError({ error })?.kind;
    return kind === "lock_not_available" || kind === "transaction_conflict";
  };
  return [
    {
      name: SCHEMA_MIGRATION,
      up: async (txCtx) => {
        for (const statement of [
          sql(/* sql */ `
CREATE TABLE {{schema}}.{{table_prefix}}job (
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,
  last_attempt_at               timestamptz,
  attempt_at                    timestamptz,
  chain_completed_at            timestamptz,

  chain_index                   integer NOT NULL,
  attempt                       integer NOT NULL DEFAULT 0,

  id                            {{job_id_type}} PRIMARY KEY,
  chain_id                      {{job_id_type}} NOT NULL,
  continued_to_id               {{job_id_type}},

  status                        text NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  chain_status                  text
                                CHECK (chain_status IN ('running', 'completed')),
  type_name                     text NOT NULL,
  chain_deduplication_key       text,
  chain_trace_context           text,
  trace_context                 text,
  last_attempt_error            jsonb,
  input                         jsonb,
  output                        jsonb,

  attempt_by                    {{worker_id_type}},
  completed_by                  {{worker_id_type}},
  attempt_token                 uuid
) WITH (
  fillfactor = 75,
  autovacuum_vacuum_cost_delay = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
)`),
          sql(/* sql */ `
CREATE UNIQUE INDEX {{table_prefix}}chain_index_idx
ON {{schema}}.{{table_prefix}}job (chain_id, chain_index)
WHERE chain_index > 0`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_deduplication_idx
ON {{schema}}.{{table_prefix}}job (chain_deduplication_key, created_at DESC)
WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at)`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_pending_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_blocked_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'blocked'`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_running_idx
ON {{schema}}.{{table_prefix}}job (type_name, attempt_at)
WHERE status = 'running'`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_completed_idx
ON {{schema}}.{{table_prefix}}job (type_name, completed_at)
WHERE status = 'completed'`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_attempt_by_idx
ON {{schema}}.{{table_prefix}}job (attempt_by, attempt_at)
WHERE status = 'running'`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_running_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0 AND chain_status = 'running'`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_completed_idx
ON {{schema}}.{{table_prefix}}job (type_name, chain_completed_at)
WHERE chain_index = 0 AND chain_status = 'completed'`),
          sql(/* sql */ `
CREATE TABLE {{schema}}.{{table_prefix}}job_blocker (
  job_id                        {{job_id_type}} NOT NULL,
  blocked_by_chain_id           {{job_id_type}} NOT NULL,
  index                         integer NOT NULL,
  trace_context                 text,
  PRIMARY KEY (job_id, blocked_by_chain_id, "index")
) WITH (
  autovacuum_vacuum_cost_delay = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
)`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_blocker_chain_idx
ON {{schema}}.{{table_prefix}}job_blocker (blocked_by_chain_id)`),
          sql(/* sql */ `
CREATE TABLE {{schema}}.{{table_prefix}}worker (
  started_at                    timestamptz NOT NULL DEFAULT now(),
  lease_until                   timestamptz NOT NULL,
  token                         uuid NOT NULL,
  concurrency                   integer NOT NULL,
  id                            {{worker_id_type}} PRIMARY KEY,
  type_names                    text[] NOT NULL
) WITH (fillfactor = 50)`),
          sql(/* sql */ `
CREATE INDEX {{table_prefix}}worker_idx
ON {{schema}}.{{table_prefix}}worker (started_at)`),
          sql(/* sql */ `
CREATE TABLE {{schema}}.{{table_prefix}}schema_fence_v1 (id integer PRIMARY KEY)`),
        ]) {
          await execute(txCtx, statement);
        }
      },
      down: async () => {
        throw new Error("The Queuert schema cannot be reverted.");
      },
    },
    {
      name: "002_schema_v2",
      type: "non-transactional",
      up: async ({ assertLockHeld }) => {
        const v1Columns =
          "created_at, scheduled_at, completed_at, last_attempt_at, attempt_at, chain_completed_at, chain_index, attempt, id, chain_id, continued_to_id, status, chain_status, type_name, chain_deduplication_key, chain_trace_context, trace_context, last_attempt_error, input, output, attempt_by, completed_by, attempt_token";
        const v2Columns = `${v1Columns}, consecutive_failures`;
        const v2Values = (row: string) =>
          [
            ...v1Columns
              .split(", ")
              .map((column) =>
                column === "last_attempt_error"
                  ? `${row}last_attempt_error #>> '{}'`
                  : `${row}${column}`,
              ),
            `(${row}last_attempt_error IS NOT NULL)::integer`,
          ].join(", ");
        const v1Indexes = [
          ["chain_index_idx", "UNIQUE INDEX", "(chain_id, chain_index) WHERE chain_index > 0"],
          [
            "chain_deduplication_idx",
            "INDEX",
            "(chain_deduplication_key, created_at DESC) WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0",
          ],
          ["job_idx", "INDEX", "(type_name, created_at)"],
          ["job_pending_idx", "INDEX", "(type_name, scheduled_at) WHERE status = 'pending'"],
          ["job_blocked_idx", "INDEX", "(type_name, scheduled_at) WHERE status = 'blocked'"],
          ["job_running_idx", "INDEX", "(type_name, attempt_at) WHERE status = 'running'"],
          ["job_completed_idx", "INDEX", "(type_name, completed_at) WHERE status = 'completed'"],
          ["job_attempt_by_idx", "INDEX", "(attempt_by, attempt_at) WHERE status = 'running'"],
          ["chain_idx", "INDEX", "(type_name, created_at) WHERE chain_index = 0"],
          [
            "chain_running_idx",
            "INDEX",
            "(type_name, created_at) WHERE chain_index = 0 AND chain_status = 'running'",
          ],
          [
            "chain_completed_idx",
            "INDEX",
            "(type_name, chain_completed_at) WHERE chain_index = 0 AND chain_status = 'completed'",
          ],
        ];

        const [{ done }] = await exec({
          sql: applyTemplate(
            sql(
              /* sql */ `
SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_attribute
  WHERE attrelid = to_regclass('{{schema}}.{{table_prefix}}job')
    AND attname = 'blocking'
    AND NOT attisdropped
) AS done`,
              { columns: { done: t.boolean() } },
            ),
          ),
        });

        if (!done) {
          await withRetry(
            async () => {
              assertLockHeld();
              await stateProvider.withTransaction(async (txCtx) => {
                for (const statement of [
                  sql(/* sql */ `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`),
                  sql(/* sql */ `SET LOCAL lock_timeout = '5000ms'`),
                  sql(/* sql */ `
LOCK TABLE {{schema}}.{{table_prefix}}job IN SHARE ROW EXCLUSIVE MODE`),
                  sql(/* sql */ `
LOCK TABLE {{schema}}.{{table_prefix}}job_blocker IN SHARE ROW EXCLUSIVE MODE NOWAIT`),
                  sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_v2 (
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,
  last_attempt_at               timestamptz,
  attempt_at                    timestamptz,
  chain_completed_at            timestamptz,

  chain_index                   integer NOT NULL,
  attempt                       integer NOT NULL DEFAULT 0,
  consecutive_failures          integer NOT NULL DEFAULT 0,

  id                            {{job_id_type}} PRIMARY KEY,
  chain_id                      {{job_id_type}} NOT NULL,
  continued_to_id               {{job_id_type}},

  status                        text NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  chain_status                  text
                                CHECK (chain_status IN ('running', 'completed')),
  type_name                     text NOT NULL,
  chain_deduplication_key       text,
  chain_trace_context           text,
  trace_context                 text,
  last_attempt_error            text,
  last_reschedule_reason        text,
  input                         jsonb,
  output                        jsonb,

  attempt_by                    {{worker_id_type}},
  completed_by                  {{worker_id_type}},
  attempt_token                 uuid,

  blocking                      boolean NOT NULL DEFAULT false,
  blockers_remaining            integer NOT NULL DEFAULT 0
) WITH (
  fillfactor = 75,
  autovacuum_vacuum_cost_delay = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
)`),
                  sql(/* sql */ `
DO $$
DECLARE
  privilege record;
BEGIN
  FOR privilege IN
    SELECT a.privilege_type, a.is_grantable,
      CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
    WHERE c.oid = to_regclass('{{schema}}.{{table_prefix}}job') AND a.grantee <> c.relowner
  LOOP
    EXECUTE format(
      'GRANT %s ON {{schema}}.{{table_prefix}}job_v2 TO %s%s',
      privilege.privilege_type,
      privilege.grantee,
      CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
    );
  END LOOP;
END
$$`),
                  ...v1Indexes.map(([name, kind, definition]) =>
                    sql(/* sql */ `
CREATE ${kind} IF NOT EXISTS {{table_prefix}}${name}_v2
ON {{schema}}.{{table_prefix}}job_v2 ${definition}`),
                  ),
                  sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_blocking_idx
ON {{schema}}.{{table_prefix}}job_v2 (type_name, created_at)
WHERE chain_index = 0 AND blocking`),
                  sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_v2_dirty (
  chain_id                      {{job_id_type}} PRIMARY KEY
)`),
                  sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_v2_dirty_blocked (
  job_id                        {{job_id_type}} PRIMARY KEY
)`),
                  sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_v2_completed (
  chain_id                      {{job_id_type}} PRIMARY KEY
)`),
                  sql(/* sql */ `
CREATE OR REPLACE FUNCTION {{schema}}.{{table_prefix}}job_v2_mirror() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  new_blocking boolean := false;
  new_blockers_remaining integer := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM {{schema}}.{{table_prefix}}job_v2 WHERE id = OLD.id;
  ELSE
    IF NEW.chain_index = 0 THEN
      new_blocking := EXISTS (
        SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = NEW.id
      );
    END IF;
    IF NEW.status = 'blocked' THEN
      SELECT count(*)::integer INTO new_blockers_remaining
      FROM {{schema}}.{{table_prefix}}job_blocker jb
      LEFT JOIN {{schema}}.{{table_prefix}}job h ON h.id = jb.blocked_by_chain_id
      WHERE jb.job_id = NEW.id AND h.chain_status IS DISTINCT FROM 'completed';
    END IF;
    INSERT INTO {{schema}}.{{table_prefix}}job_v2 (${v2Columns}, blocking, blockers_remaining)
    VALUES (${v2Values("NEW.")}, new_blocking, new_blockers_remaining)
    ON CONFLICT (id) DO UPDATE SET ${[...v2Columns.split(", "), "blockers_remaining"]
      .filter((column) => column !== "id")
      .map((column) => `${column} = EXCLUDED.${column}`)
      .join(", ")}, blocking = {{table_prefix}}job_v2.blocking OR EXCLUDED.blocking;
    IF NEW.status = 'blocked' AND new_blockers_remaining = 0 THEN
      INSERT INTO {{schema}}.{{table_prefix}}job_v2_dirty_blocked (job_id) VALUES (NEW.id)
      ON CONFLICT DO NOTHING;
    END IF;
    IF NEW.chain_index = 0 AND NEW.chain_status = 'completed'
      AND (TG_OP = 'INSERT' OR OLD.chain_status IS DISTINCT FROM 'completed') THEN
      INSERT INTO {{schema}}.{{table_prefix}}job_v2_completed (chain_id) VALUES (NEW.id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END
$$`),
                  sql(/* sql */ `
DROP TRIGGER IF EXISTS {{table_prefix}}job_v2_mirror ON {{schema}}.{{table_prefix}}job`),
                  sql(/* sql */ `
CREATE CONSTRAINT TRIGGER {{table_prefix}}job_v2_mirror
AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.{{table_prefix}}job
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{table_prefix}}job_v2_mirror()`),
                  sql(/* sql */ `
CREATE OR REPLACE FUNCTION {{schema}}.{{table_prefix}}job_v2_mark_dirty() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO {{schema}}.{{table_prefix}}job_v2_dirty (chain_id) VALUES (OLD.blocked_by_chain_id)
    ON CONFLICT DO NOTHING;
    RETURN NULL;
  END IF;
  PERFORM 1 FROM {{schema}}.{{table_prefix}}job_v2 WHERE id = NEW.blocked_by_chain_id AND blocking;
  IF NOT FOUND THEN
    UPDATE {{schema}}.{{table_prefix}}job_v2 SET blocking = true WHERE id = NEW.blocked_by_chain_id;
    IF NOT FOUND THEN
      INSERT INTO {{schema}}.{{table_prefix}}job_v2_dirty (chain_id) VALUES (NEW.blocked_by_chain_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  PERFORM 1 FROM {{schema}}.{{table_prefix}}job
  WHERE id = NEW.job_id AND xmin = pg_current_xact_id()::xid;
  IF NOT FOUND THEN
    INSERT INTO {{schema}}.{{table_prefix}}job_v2_dirty_blocked (job_id) VALUES (NEW.job_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$$`),
                  sql(/* sql */ `
CREATE OR REPLACE TRIGGER {{table_prefix}}job_v2_mark_dirty
AFTER INSERT OR DELETE ON {{schema}}.{{table_prefix}}job_blocker
FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{table_prefix}}job_v2_mark_dirty()`),
                ]) {
                  await execute(txCtx, statement);
                }
              });
            },
            LOCK_RETRY,
            isLockConflict,
          );

          const copyBatch = applyTemplate(
            sql(
              /* sql */ `
WITH source AS (
  SELECT ${v1Columns} FROM {{schema}}.{{table_prefix}}job
  WHERE $1::{{job_id_type}} IS NULL OR id > $1::{{job_id_type}}
  ORDER BY id
  LIMIT 1000
  FOR KEY SHARE
),
counted AS (
  SELECT source.*,
    CASE WHEN source.status = 'blocked' THEN (
      SELECT count(*)::integer
      FROM {{schema}}.{{table_prefix}}job_blocker jb
      LEFT JOIN {{schema}}.{{table_prefix}}job h ON h.id = jb.blocked_by_chain_id
      WHERE jb.job_id = source.id AND h.chain_status IS DISTINCT FROM 'completed'
    ) ELSE 0 END AS blockers_remaining
  FROM source
),
copied AS (
  INSERT INTO {{schema}}.{{table_prefix}}job_v2 (${v2Columns}, blocking, blockers_remaining)
  SELECT ${v2Values("")
    .split(", ")
    .map((column) =>
      column === "status"
        ? "CASE WHEN status = 'blocked' AND blockers_remaining = 0 THEN 'pending' ELSE status END"
        : column === "scheduled_at"
          ? "CASE WHEN status = 'blocked' AND blockers_remaining = 0 THEN GREATEST(scheduled_at, now()) ELSE scheduled_at END"
          : column,
    )
    .join(", ")},
    chain_index = 0 AND EXISTS (
      SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = counted.id
    ),
    blockers_remaining
  FROM counted
  ON CONFLICT (id) DO NOTHING
)
SELECT (SELECT id FROM source ORDER BY id DESC LIMIT 1)::text AS last_id`,
              { params: [t["string?"]()], columns: { last_id: t["string?"]() } },
            ),
          );
          const [{ copied }] = await exec({
            sql: applyTemplate(
              sql(
                /* sql */ `
SELECT to_regclass('{{schema}}.{{table_prefix}}job_v2_copied') IS NOT NULL AS copied`,
                { columns: { copied: t.boolean() } },
              ),
            ),
          });
          if (!copied) {
            let lastId = null as string | null;
            do {
              const fromId = lastId;
              lastId = await withRetry(
                async () => {
                  assertLockHeld();
                  return stateProvider.withTransaction(async (txCtx) => {
                    await execute(
                      txCtx,
                      sql(/* sql */ `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`),
                    );
                    await execute(txCtx, sql(/* sql */ `SET LOCAL lock_timeout = '5000ms'`));
                    const [row] = await exec({ txCtx, sql: copyBatch, params: [fromId] });
                    return row.last_id;
                  });
                },
                LOCK_RETRY,
                isLockConflict,
              );
            } while (lastId !== null);
            await execute(
              undefined,
              sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_v2_copied (id integer PRIMARY KEY)`),
            );
          }

          await withRetry(
            async () => {
              assertLockHeld();
              await stateProvider.withTransaction(async (txCtx) => {
                for (const statement of [
                  sql(/* sql */ `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`),
                  sql(/* sql */ `SET LOCAL lock_timeout = '5000ms'`),
                  sql(/* sql */ `
LOCK TABLE {{schema}}.{{table_prefix}}job IN ACCESS EXCLUSIVE MODE`),
                  sql(/* sql */ `
LOCK TABLE {{schema}}.{{table_prefix}}job_blocker IN ACCESS EXCLUSIVE MODE NOWAIT`),
                  sql(/* sql */ `SET LOCAL enable_seqscan = off`),
                  sql(/* sql */ `SET LOCAL enable_hashjoin = off`),
                  sql(/* sql */ `SET LOCAL enable_mergejoin = off`),
                  sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}schema_fence_v2 (id integer PRIMARY KEY)`),
                  sql(/* sql */ `
DROP TABLE IF EXISTS {{schema}}.{{table_prefix}}schema_fence_v1`),
                  sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job_v2 h
SET blocking = EXISTS (
  SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = h.id
)
WHERE h.chain_index = 0
  AND h.id IN (SELECT chain_id FROM {{schema}}.{{table_prefix}}job_v2_dirty)`),
                  sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job_v2 j
SET blockers_remaining = c.blockers_remaining,
  status = CASE WHEN c.blockers_remaining = 0 THEN 'pending' ELSE j.status END,
  scheduled_at = CASE
    WHEN c.blockers_remaining = 0 THEN GREATEST(j.scheduled_at, now()) ELSE j.scheduled_at END
FROM (
  SELECT jb.job_id,
    count(*) FILTER (WHERE h.chain_status IS DISTINCT FROM 'completed')::integer AS blockers_remaining
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  LEFT JOIN {{schema}}.{{table_prefix}}job_v2 h ON h.id = jb.blocked_by_chain_id
  WHERE jb.job_id IN (
    SELECT dependent.job_id
    FROM {{schema}}.{{table_prefix}}job_blocker dependent
    JOIN {{schema}}.{{table_prefix}}job_v2 d ON d.id = dependent.job_id AND d.status = 'blocked'
    WHERE dependent.blocked_by_chain_id IN (
      SELECT chain_id FROM {{schema}}.{{table_prefix}}job_v2_completed
    )
    UNION
    SELECT job_id FROM {{schema}}.{{table_prefix}}job_v2_dirty_blocked
  )
  GROUP BY jb.job_id
) c
WHERE j.id = c.job_id AND j.status = 'blocked'`),
                  sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job_v2 j
SET status = 'pending',
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_token = NULL
WHERE j.status = 'running'
  AND NOT EXISTS (
    SELECT 1 FROM {{schema}}.{{table_prefix}}worker w WHERE w.id = j.attempt_by
  )`),
                  sql(/* sql */ `
DROP TABLE {{schema}}.{{table_prefix}}job`),
                  sql(/* sql */ `
DROP TRIGGER {{table_prefix}}job_v2_mark_dirty ON {{schema}}.{{table_prefix}}job_blocker`),
                  sql(/* sql */ `
DROP FUNCTION {{schema}}.{{table_prefix}}job_v2_mark_dirty()`),
                  sql(/* sql */ `
DROP FUNCTION {{schema}}.{{table_prefix}}job_v2_mirror()`),
                  sql(/* sql */ `
DROP TABLE {{schema}}.{{table_prefix}}job_v2_dirty`),
                  sql(/* sql */ `
DROP TABLE {{schema}}.{{table_prefix}}job_v2_dirty_blocked`),
                  sql(/* sql */ `
DROP TABLE {{schema}}.{{table_prefix}}job_v2_completed`),
                  sql(/* sql */ `
DROP TABLE IF EXISTS {{schema}}.{{table_prefix}}job_v2_copied`),
                  sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job_v2 RENAME TO {{table_prefix}}job`),
                  sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job
  RENAME CONSTRAINT {{table_prefix}}job_v2_pkey TO {{table_prefix}}job_pkey`),
                  sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job
  RENAME CONSTRAINT {{table_prefix}}job_v2_status_check TO {{table_prefix}}job_status_check`),
                  sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job
  RENAME CONSTRAINT {{table_prefix}}job_v2_chain_status_check TO {{table_prefix}}job_chain_status_check`),
                  sql(/* sql */ `
DO $$
DECLARE
  constraint_name name;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_catalog.pg_constraint
    WHERE conrelid = to_regclass('{{schema}}.{{table_prefix}}job')
      AND contype = 'n'
      AND left(conname, length('{{table_prefix}}job_v2_')) = '{{table_prefix}}job_v2_'
  LOOP
    EXECUTE format(
      'ALTER TABLE {{schema}}.{{table_prefix}}job RENAME CONSTRAINT %I TO %I',
      constraint_name,
      '{{table_prefix}}job_' || substr(constraint_name, length('{{table_prefix}}job_v2_') + 1)
    );
  END LOOP;
END
$$`),
                  ...v1Indexes.map(([name]) =>
                    sql(/* sql */ `
ALTER INDEX {{schema}}.{{table_prefix}}${name}_v2 RENAME TO {{table_prefix}}${name}`),
                  ),
                ]) {
                  await execute(txCtx, statement);
                }
              });
            },
            LOCK_RETRY,
            isLockConflict,
          );
          await execute(undefined, sql(/* sql */ `ANALYZE {{schema}}.{{table_prefix}}job`));
        }

        await stateProvider.withTransaction(async (txCtx) => {
          for (const statement of [
            sql(/* sql */ `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`),
            sql(/* sql */ `SET LOCAL lock_timeout = '5000ms'`),
            sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}schema_fence_v2 (id integer PRIMARY KEY)`),
            sql(/* sql */ `
DROP TABLE IF EXISTS {{schema}}.{{table_prefix}}schema_fence_v1`),
          ]) {
            await execute(txCtx, statement);
          }
        });
      },
      down: async () => {
        throw new Error("The Queuert schema cannot be reverted.");
      },
    },
  ];
};

export const createMigrationStore = <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
): MigrationStore<TTxContext> =>
  createPgMigrationStore({
    stateProvider,
    schema: applyTemplate(sql("{{schema}}")).sql,
    createSchema: false,
    migrationTable: applyTemplate(sql("{{schema}}.{{table_prefix}}migration")).sql,
    lockTable: applyTemplate(sql("{{schema}}.{{table_prefix}}migration_lock")).sql,
  });

export const migrateSchemaToLatest = async <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
): Promise<MigrationResult> => {
  const store = createMigrationStore(stateProvider, applyTemplate);
  const migrations = createSchemaMigrations(stateProvider, applyTemplate);
  const snapshot = createSchemaSnapshot(stateProvider, applyTemplate);
  const installed: string[] = [];
  const result = await createMigrator({
    migrations,
    store,
    before: async () => {
      installed.push(
        ...(await store.runInTransaction(async (txCtx) => {
          if ((await store.getAppliedMigrationNames(txCtx)).length > 0) return [];
          await snapshot(txCtx);
          for (const { name } of migrations) await store.recordMigration(txCtx, name);
          return migrations.map(({ name }) => name);
        })),
      );
    },
  }).migrateToLatest();
  return {
    ...result,
    applied: [...installed, ...result.applied],
    skipped: result.skipped.filter((name) => !installed.includes(name)),
  };
};
