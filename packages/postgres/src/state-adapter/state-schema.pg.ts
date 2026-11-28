import { type TemplateApplier, createTypedSqlExecutor, sql } from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

export const SCHEMA_VERSION = 2;

export const createSchemaSnapshot = <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
): ((txCtx: TTxContext) => Promise<void>) => {
  const exec = createTypedSqlExecutor(stateProvider);
  return async (txCtx) => {
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
CREATE INDEX {{table_prefix}}chain_blocking_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0 AND blocking`),
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
CREATE TABLE {{schema}}.{{table_prefix}}schema_fence_v${SCHEMA_VERSION} (id integer PRIMARY KEY)`),
    ]) {
      await exec({ txCtx, sql: applyTemplate(statement) });
    }
  };
};
