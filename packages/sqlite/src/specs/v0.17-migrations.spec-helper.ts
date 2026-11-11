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
CREATE TABLE IF NOT EXISTS {{table_prefix}}job (
  created_at                    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  scheduled_at                  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  completed_at                  TEXT,
  last_attempt_at               TEXT,
  attempt_at                    TEXT,
  attempt_until                 TEXT,
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
  output                        TEXT
)`),
      sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)
WHERE chain_index > 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_deduplication_idx
ON {{table_prefix}}job (chain_deduplication_key, created_at DESC)
WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_idx
ON {{table_prefix}}job (type_name, created_at)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_pending_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocked_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'blocked'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_running_idx
ON {{table_prefix}}job (type_name, attempt_until)
WHERE status = 'running'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_completed_idx
ON {{table_prefix}}job (type_name, completed_at)
WHERE status = 'completed'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_idx
ON {{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_running_idx
ON {{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0 AND chain_status = 'running'`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_completed_idx
ON {{table_prefix}}job (type_name, chain_completed_at)
WHERE chain_index = 0 AND chain_status = 'completed'`),
      sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}job_blocker (
  job_id                        {{job_id_type}} NOT NULL,
  blocked_by_chain_id           {{job_id_type}} NOT NULL,
  "index"                       INTEGER NOT NULL,
  trace_context                 TEXT,
  PRIMARY KEY (job_id, blocked_by_chain_id, "index")
)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`),
    ],
  },
  {
    name: "002_worker_liveness",
    statements: [
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
ALTER TABLE {{table_prefix}}job ADD COLUMN attempt_token TEXT`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_attempt_by_idx
ON {{table_prefix}}job (attempt_by, attempt_at)
WHERE status = 'running'`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}worker_idx
ON {{table_prefix}}worker (started_at)`),
      sql(/* sql */ `
UPDATE {{table_prefix}}job
SET status = 'pending',
  attempt_at = NULL,
  attempt_by = NULL
WHERE status = 'running'`),
      sql(/* sql */ `
DROP INDEX {{table_prefix}}job_running_idx`),
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job DROP COLUMN attempt_until`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_running_idx
ON {{table_prefix}}job (type_name, attempt_at)
WHERE status = 'running'`),
    ],
  },
];

export const createV017Migrations = <TTxContext>(
  execute: (txCtx: TTxContext, statement: TypedSqlTemplate<readonly []>) => Promise<void>,
): Migration<TTxContext>[] =>
  v017Statements.map(({ name, statements }) => transactional(name, statements, execute));
