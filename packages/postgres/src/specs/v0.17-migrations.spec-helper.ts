import { type Migration, type TypedSqlTemplate, sql } from "@queuert/typed-sql";

const transactional = <TTxContext>(
  name: string,
  statements: TypedSqlTemplate<readonly []>[],
  execute: (txCtx: TTxContext, statement: TypedSqlTemplate<readonly []>) => Promise<void>,
): Migration<TTxContext> => ({
  name,
  up: async (txCtx) => {
    for (const statement of statements) {
      await execute(txCtx, statement);
    }
  },
  down: async () => {
    throw new Error(`${name} cannot be reverted.`);
  },
});

const v017Statements: { name: string; statements: TypedSqlTemplate<readonly []>[] }[] = [
  {
    name: "001_initial_schema",
    statements: [
      sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job (
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,
  last_attempt_at               timestamptz,
  attempt_at                    timestamptz,
  attempt_until                 timestamptz,
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
  completed_by                  text,
  attempt_by                    text,
  chain_deduplication_key       text,
  chain_trace_context           text,
  trace_context                 text,
  last_attempt_error            jsonb,
  input                         jsonb,
  output                        jsonb
) WITH (
  fillfactor = 75,
  autovacuum_vacuum_cost_delay = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
)`),
      sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}chain_index_idx
ON {{schema}}.{{table_prefix}}job (chain_id, chain_index)
WHERE chain_index > 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_deduplication_idx
ON {{schema}}.{{table_prefix}}job (chain_deduplication_key, created_at DESC)
WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_pending_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocked_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'blocked'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_running_idx
ON {{schema}}.{{table_prefix}}job (type_name, attempt_until)
WHERE status = 'running'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_completed_idx
ON {{schema}}.{{table_prefix}}job (type_name, completed_at)
WHERE status = 'completed'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_running_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0 AND chain_status = 'running'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_completed_idx
ON {{schema}}.{{table_prefix}}job (type_name, chain_completed_at)
WHERE chain_index = 0 AND chain_status = 'completed'`),
      sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_blocker (
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
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{schema}}.{{table_prefix}}job_blocker (blocked_by_chain_id)`),
    ],
  },
  {
    name: "002_worker_liveness",
    statements: [
      sql(/* sql */ `SET LOCAL lock_timeout = '5000ms'`),
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
ALTER TABLE {{schema}}.{{table_prefix}}job
  DROP COLUMN attempt_by,
  DROP COLUMN completed_by,
  ADD COLUMN attempt_by {{worker_id_type}},
  ADD COLUMN completed_by {{worker_id_type}},
  ADD COLUMN attempt_token uuid`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_attempt_by_idx
ON {{schema}}.{{table_prefix}}job (attempt_by, attempt_at)
WHERE status = 'running'`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}worker_idx
ON {{schema}}.{{table_prefix}}worker (started_at)`),
      sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET status = 'pending',
  attempt_at = NULL
WHERE status = 'running'`),
      sql(/* sql */ `
DROP INDEX {{schema}}.{{table_prefix}}job_running_idx`),
      sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job DROP COLUMN attempt_until`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_running_idx
ON {{schema}}.{{table_prefix}}job (type_name, attempt_at)
WHERE status = 'running'`),
    ],
  },
];

export const createV017Migrations = <TTxContext>(
  execute: (txCtx: TTxContext, statement: TypedSqlTemplate<readonly []>) => Promise<void>,
): Migration<TTxContext>[] =>
  v017Statements.map(({ name, statements }) => transactional(name, statements, execute));
