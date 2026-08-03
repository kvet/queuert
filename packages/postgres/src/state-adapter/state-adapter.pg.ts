import { type UUID, randomUUID } from "node:crypto";

import {
  type DataType,
  type InferColumns,
  type InferParams,
  type Migration,
  type MigrationResult,
  type MigrationStore,
  type TemplateApplier,
  type TypedSql,
  createMigrator,
  createTemplateApplier,
  createTemplateCache,
  extractColumnTypes,
  extractParamTypes,
  sql,
  t,
} from "@queuert/typed-sql";
import { type BaseTxContext, type StateAdapter } from "queuert";
import {
  type StateJob,
  createIdValidator,
  decodeIdCursor,
  decodeTimestampWithIdCursor,
  encodeCursor,
} from "queuert/internal";

import { type PgStateProvider } from "../state-provider/state-provider.pg.js";

type DbJob = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_type_name: string;
  chain_index: number;
  continued_to_id: string | null;

  input: unknown;
  output: unknown;

  blocked: boolean;
  created_at: string;
  scheduled_at: string;
  completed_at: string | null;
  completed_by: string | null;

  attempt: number;
  last_attempt_error: string | null;
  last_attempt_at: string | null;

  attempt_at: string | null;
  attempt_by: string | null;
  attempt_until: string | null;

  deduplication_key: string | null;

  chain_trace_context: string | null;
  trace_context: string | null;
};

const concurrentIndex = (
  name: string,
  on: string,
  columns: string,
  where?: string,
  unique?: boolean,
) => [
  sql(/* sql */ `
DO $$ BEGIN
  PERFORM 1 FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_index i ON i.indexrelid = c.oid
  WHERE n.nspname = '{{schema}}' AND c.relname = '${name}' AND NOT i.indisvalid;
  IF FOUND THEN EXECUTE 'DROP INDEX {{schema}}.${name}'; END IF;
END $$`),
  sql(/* sql */ `
CREATE ${unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS ${name}
ON {{schema}}.${on} (${columns})${where ? `\nWHERE ${where}` : ""}`),
];

/** @internal */
export const migrations: Migration[] = [
  {
    name: "20240101000000_initial_schema",
    type: "transactional",
    statements: [
      sql(/* sql */ `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{{table_prefix}}job_status' AND typnamespace = '{{schema}}'::regnamespace) THEN
    CREATE TYPE {{schema}}.{{table_prefix}}job_status AS ENUM ('blocked','pending','running','completed');
  END IF;
END$$`),
      sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job (
  id                            {{id_type}} PRIMARY KEY,
  type_name                     text NOT NULL,
  chain_id                      {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  chain_type_name               text NOT NULL,
  chain_index                   integer NOT NULL,

  input                         jsonb,
  output                        jsonb,

  -- state
  status                        {{schema}}.{{table_prefix}}job_status NOT NULL DEFAULT 'pending',
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,
  completed_by                  text,

  -- attempts
  attempt                       integer NOT NULL DEFAULT 0,
  last_attempt_at               timestamptz,
  last_attempt_error            jsonb,

  -- leasing
  leased_by                     text,
  leased_until                  timestamptz,

  -- deduplication
  deduplication_key             text,

  -- tracing
  chain_trace_context           text,
  trace_context                 text
)`),
      sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_blocker (
  job_id                        {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  index                         integer NOT NULL,
  trace_context                 text,
  PRIMARY KEY (job_id, blocked_by_chain_id)
)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_acquisition_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}job_chain_index_idx
ON {{schema}}.{{table_prefix}}job (chain_id, chain_index)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{schema}}.{{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_expired_lease_idx
ON {{schema}}.{{table_prefix}}job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{schema}}.{{table_prefix}}job_blocker (blocked_by_chain_id)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_idx
ON {{schema}}.{{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_idx
ON {{schema}}.{{table_prefix}}job (created_at DESC)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_status_idx
ON {{schema}}.{{table_prefix}}job (status, created_at DESC)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_type_name_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at DESC)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_type_name_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`),
    ],
  },
  {
    name: "20240102000000_vacuum_tuning",
    type: "transactional",
    statements: [
      sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job SET (
  fillfactor = 75,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 0
)`),
      sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job_blocker SET (
  autovacuum_vacuum_cost_delay = 0
)`),
    ],
  },
  {
    name: "20260430000000_rename_chain_indexes",
    type: "transactional",
    statements: [
      sql(/* sql */ `
ALTER INDEX IF EXISTS {{schema}}.{{table_prefix}}job_chain_index_idx
RENAME TO {{table_prefix}}chain_index_idx`),
      sql(/* sql */ `
ALTER INDEX IF EXISTS {{schema}}.{{table_prefix}}job_chain_listing_idx
RENAME TO {{table_prefix}}chain_listing_idx`),
      sql(/* sql */ `
ALTER INDEX IF EXISTS {{schema}}.{{table_prefix}}job_chain_listing_type_name_idx
RENAME TO {{table_prefix}}chain_listing_type_name_idx`),
    ],
  },
  {
    name: "20260517000000_drop_job_id_default",
    type: "transactional",
    statements: [
      sql(/* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job ALTER COLUMN id DROP DEFAULT`),
    ],
  },
  {
    name: "20260531000000_vacuum_threshold_pinning",
    type: "transactional",
    statements: [
      sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job SET (
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
)`),
      sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job_blocker SET (
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
)`),
    ],
  },
  {
    name: "20260617000000_blocker_composite_pk",
    type: "transactional",
    statements: [
      sql(`
ALTER TABLE {{schema}}.{{table_prefix}}job_blocker
  DROP CONSTRAINT {{table_prefix}}job_blocker_pkey,
  ADD PRIMARY KEY (job_id, blocked_by_chain_id, "index")`),
    ],
  },
  {
    name: "20260622000000_job_model_v2_columns",
    type: "transactional",
    statements: [
      sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job
  ADD COLUMN IF NOT EXISTS continued_to_id {{id_type}} REFERENCES {{schema}}.{{table_prefix}}job(id),
  ADD COLUMN IF NOT EXISTS leased_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false`),
    ],
  },
  {
    name: "20260622000001_job_model_v2_backfill",
    type: "batched",
    statements: [
      sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET continued_to_id = sub.next_id
FROM (
  SELECT j.id, n.id AS next_id
  FROM {{schema}}.{{table_prefix}}job j
  JOIN {{schema}}.{{table_prefix}}job n
    ON n.chain_id = j.chain_id AND n.chain_index = j.chain_index + 1
  WHERE j.continued_to_id IS NULL
  LIMIT 1000
) sub
WHERE {{schema}}.{{table_prefix}}job.id = sub.id`),
      sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET blocked = true, status = 'pending'
WHERE id IN (
  SELECT id FROM {{schema}}.{{table_prefix}}job
  WHERE status = 'blocked'
  LIMIT 1000
)`),
      sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET leased_at = COALESCE(leased_until, now()),
  leased_by = COALESCE(leased_by, 'migrated')
WHERE id IN (
  SELECT id FROM {{schema}}.{{table_prefix}}job
  WHERE status = 'running' AND (leased_at IS NULL OR leased_by IS NULL)
  LIMIT 1000
)`),
    ],
  },
  {
    name: "20260622000002_job_model_v2_finalize",
    type: "transactional",
    // Atomic catch-up-and-cut: old-version workers keep minting old-shape rows
    // behind the batched drain, so the finalize takes an exclusive table lock,
    // backfills the stragglers under it, and applies the DDL cut in the same
    // transaction. The commit errors every old-worker statement — the cut.
    statements: [
      sql(/* sql */ `
LOCK TABLE {{schema}}.{{table_prefix}}job IN ACCESS EXCLUSIVE MODE`),
      sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET continued_to_id = sub.next_id
FROM (
  SELECT j.id, n.id AS next_id
  FROM {{schema}}.{{table_prefix}}job j
  JOIN {{schema}}.{{table_prefix}}job n
    ON n.chain_id = j.chain_id AND n.chain_index = j.chain_index + 1
  WHERE j.continued_to_id IS NULL
) sub
WHERE {{schema}}.{{table_prefix}}job.id = sub.id`),
      sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET blocked = true, status = 'pending'
WHERE status = 'blocked'`),
      sql(/* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET leased_at = COALESCE(leased_until, now()),
  leased_by = COALESCE(leased_by, 'migrated')
WHERE status = 'running' AND (leased_at IS NULL OR leased_by IS NULL)`),
      sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job DROP COLUMN IF EXISTS status`),
      sql(/* sql */ `
DROP TYPE IF EXISTS {{schema}}.{{table_prefix}}job_status`),
      sql(
        /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job RENAME COLUMN leased_at TO attempt_at`,
      ),
      sql(
        /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job RENAME COLUMN leased_by TO attempt_by`,
      ),
      sql(
        /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job RENAME COLUMN leased_until TO attempt_until`,
      ),
    ],
  },
  {
    name: "20260622000003_job_model_v2_indexes",
    type: "non-transactional",
    statements: [
      sql(/* sql */ `
DROP INDEX CONCURRENTLY IF EXISTS {{schema}}.{{table_prefix}}job_acquisition_idx`),
      sql(/* sql */ `
DROP INDEX CONCURRENTLY IF EXISTS {{schema}}.{{table_prefix}}job_expired_lease_idx`),
      sql(/* sql */ `
DROP INDEX CONCURRENTLY IF EXISTS {{schema}}.{{table_prefix}}job_listing_status_idx`),
      sql(/* sql */ `
DROP INDEX CONCURRENTLY IF EXISTS {{schema}}.{{table_prefix}}job_listing_type_name_idx`),
      sql(/* sql */ `
DROP INDEX CONCURRENTLY IF EXISTS {{schema}}.{{table_prefix}}chain_listing_type_name_idx`),
      sql(/* sql */ `
DROP INDEX CONCURRENTLY IF EXISTS {{schema}}.{{table_prefix}}chain_listing_idx`),
      sql(/* sql */ `
DROP INDEX CONCURRENTLY IF EXISTS {{schema}}.{{table_prefix}}job_listing_idx`),
      ...concurrentIndex(
        "{{table_prefix}}job_ready_idx",
        "{{table_prefix}}job",
        "type_name, scheduled_at",
        "blocked = false AND attempt_at IS NULL AND completed_at IS NULL",
      ),
      ...concurrentIndex(
        "{{table_prefix}}job_pending_idx",
        "{{table_prefix}}job",
        "scheduled_at",
        "attempt_at IS NULL AND completed_at IS NULL",
      ),
      ...concurrentIndex(
        "{{table_prefix}}job_running_idx",
        "{{table_prefix}}job",
        "type_name, attempt_until",
        "attempt_at IS NOT NULL AND completed_at IS NULL",
      ),
      ...concurrentIndex(
        "{{table_prefix}}job_completed_idx",
        "{{table_prefix}}job",
        "completed_at",
        "completed_at IS NOT NULL",
      ),
      ...concurrentIndex(
        "{{table_prefix}}job_continuation_idx",
        "{{table_prefix}}job",
        "continued_to_id",
        "continued_to_id IS NOT NULL",
        true,
      ),
      ...concurrentIndex(
        "{{table_prefix}}chain_tail_open_idx",
        "{{table_prefix}}job",
        "chain_id",
        "continued_to_id IS NULL AND completed_at IS NULL",
      ),
      ...concurrentIndex(
        "{{table_prefix}}chain_tail_completed_idx",
        "{{table_prefix}}job",
        "chain_id",
        "continued_to_id IS NULL AND completed_at IS NOT NULL",
      ),
      ...concurrentIndex(
        "{{table_prefix}}chain_head_idx",
        "{{table_prefix}}job",
        "created_at",
        "chain_index = 0",
      ),
      ...concurrentIndex("{{table_prefix}}job_idx", "{{table_prefix}}job", "created_at"),
    ],
  },
];

/** @internal */
export const createMigrationStore = <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
): MigrationStore<TTxContext> => {
  const exec = async <
    TParams extends readonly DataType[],
    TColumns extends Record<string, DataType>,
  >({
    txCtx,
    sql: typedSql,
    params,
  }: {
    txCtx?: TTxContext;
    sql: TypedSql<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): Promise<InferColumns<TColumns>[]> =>
    stateProvider.executeSql({
      txCtx,
      id: typedSql.id,
      sql: typedSql.sql,
      params: params ?? [],
      paramTypes: extractParamTypes(typedSql.params),
      columnTypes: extractColumnTypes(typedSql.columns),
      readOnly: typedSql.readOnly,
    }) as Promise<InferColumns<TColumns>[]>;
  const createMigrationTableSql = applyTemplate(
    sql(
      `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}migration (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
      { id: "createMigrationTable", params: [], columns: {} },
    ),
  );
  const getAppliedMigrationsSql = applyTemplate(
    sql(/* sql */ `SELECT name FROM {{schema}}.{{table_prefix}}migration ORDER BY name`, {
      id: "getAppliedMigrations",
      params: [],
      columns: { name: t.string() },
      readOnly: true,
    }),
  );
  const recordMigrationSql = applyTemplate(
    sql(
      `INSERT INTO {{schema}}.{{table_prefix}}migration (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      { id: "recordMigration", params: [t.string()], columns: {} },
    ),
  );
  const serializeBootstrapSql = applyTemplate(
    sql(
      `DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('{{schema}}.{{table_prefix}}migration_lock'), 0); END $$`,
      { id: "bootstrapMigrationLock", params: [], columns: {}, readOnly: true },
    ),
  );
  const createMigrationLockTableSql = applyTemplate(
    sql(
      `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}migration_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked_by TEXT NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL
)`,
      { id: "createMigrationLockTable", params: [], columns: {} },
    ),
  );
  const acquireMigrationLockSql = applyTemplate(
    sql(
      `
INSERT INTO {{schema}}.{{table_prefix}}migration_lock AS l (id, locked_by, locked_until)
VALUES (1, $1, now() + ($2::integer * interval '1 millisecond'))
ON CONFLICT (id) DO UPDATE SET locked_by = EXCLUDED.locked_by, locked_until = EXCLUDED.locked_until
WHERE l.locked_until <= now() OR l.locked_by = EXCLUDED.locked_by
RETURNING 1 AS acquired`,
      {
        id: "acquireMigrationLock",
        params: [t.string(), t.number()],
        columns: { acquired: t.number() },
      },
    ),
  );
  const extendMigrationLockSql = applyTemplate(
    sql(
      `
UPDATE {{schema}}.{{table_prefix}}migration_lock
SET locked_until = now() + ($2::integer * interval '1 millisecond')
WHERE id = 1 AND locked_by = $1 AND locked_until > now()
RETURNING 1 AS extended`,
      {
        id: "extendMigrationLock",
        params: [t.string(), t.number()],
        columns: { extended: t.number() },
      },
    ),
  );
  const releaseMigrationLockSql = applyTemplate(
    sql(`DELETE FROM {{schema}}.{{table_prefix}}migration_lock WHERE id = 1 AND locked_by = $1`, {
      id: "releaseMigrationLock",
      params: [t.string()],
      columns: {},
    }),
  );

  return {
    initialize: async () => {
      await stateProvider.withTransaction(async (txCtx) => {
        await exec({ txCtx, sql: serializeBootstrapSql });
        await exec({ txCtx, sql: createMigrationTableSql });
        await exec({ txCtx, sql: createMigrationLockTableSql });
      });
    },
    runInTransaction: stateProvider.withTransaction,
    getAppliedMigrationNames: async (txCtx) => {
      const applied = await exec({ txCtx, sql: getAppliedMigrationsSql });
      return applied.map((m) => m.name);
    },
    executeMigrationStatement: async (txCtx, statement) => {
      await exec({ txCtx, sql: applyTemplate(statement) as TypedSql<readonly []> });
    },
    executeBatchMigrationStatement: async (txCtx, statement) => {
      const applied = applyTemplate(statement);
      const wrapped = applyTemplate(
        sql(
          `WITH _batch AS (${applied.sql} RETURNING 1) SELECT count(*)::int AS affected FROM _batch`,
          {
            id: applied.id != null ? `batch:${applied.id}` : undefined,
            params: [],
            columns: { affected: t.number() },
          },
        ),
      );
      const [row] = await exec({ txCtx, sql: wrapped });
      return row?.affected ?? 0;
    },
    recordMigration: async (txCtx, name) => {
      await exec({ txCtx, sql: recordMigrationSql, params: [name] });
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

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const validateSqlIdentifier = (value: string, name: string): void => {
  if (!SQL_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: "${value}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ to prevent SQL injection.`,
    );
  }
};

type DbChainRow = { head_job: DbJob; tail_job: DbJob | null };

const classifyJobRows = (
  jobIds: readonly string[],
  rows: readonly DbJob[],
): (StateJob | undefined)[] => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return jobIds.map((id): StateJob | undefined => {
    const row = byId.get(id);
    return row ? mapDbJobToStateJob(row) : undefined;
  });
};

const classifyChainRows = (
  chainIds: readonly string[],
  rows: readonly DbChainRow[],
): ([StateJob, StateJob | undefined] | undefined)[] => {
  const byId = new Map(rows.map((r) => [r.head_job.id, r]));
  return chainIds.map((id): [StateJob, StateJob | undefined] | undefined => {
    const row = byId.get(id);
    if (!row) return undefined;
    return [
      mapDbJobToStateJob(row.head_job),
      row.tail_job && row.tail_job.id !== row.head_job.id
        ? mapDbJobToStateJob(row.tail_job)
        : undefined,
    ];
  });
};

const mapDbJobToStateJob = (dbJob: DbJob): StateJob => {
  return {
    id: dbJob.id,
    typeName: dbJob.type_name,
    chainId: dbJob.chain_id,
    chainTypeName: dbJob.chain_type_name,
    continuedToId: dbJob.continued_to_id,
    input: dbJob.input,
    output: dbJob.output,

    blocked: dbJob.blocked,
    createdAt: new Date(dbJob.created_at),
    scheduledAt: new Date(dbJob.scheduled_at),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at) : null,
    completedBy: dbJob.completed_by,

    attempt: dbJob.attempt,
    lastAttemptError: dbJob.last_attempt_error,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at) : null,

    attemptAt: dbJob.attempt_at ? new Date(dbJob.attempt_at) : null,
    attemptBy: dbJob.attempt_by,
    attemptUntil: dbJob.attempt_until ? new Date(dbJob.attempt_until) : null,

    deduplicationKey: dbJob.deduplication_key,

    chainTraceContext: dbJob.chain_trace_context,
    traceContext: dbJob.trace_context,
  };
};

/**
 * Create a state adapter backed by PostgreSQL. Returns the adapter with a
 * `migrateToLatest()` method for schema migrations.
 *
 * @param options - PostgreSQL state adapter configuration.
 */
export const createPgStateAdapter = async <
  TTxContext extends BaseTxContext,
  TIdType extends string = UUID,
>({
  stateProvider,
  schema = "public",
  tablePrefix = "queuert_",
  idType = "uuid",
  generateId: generateIdOption = (() => randomUUID()) as () => TIdType,
  validateId: validateIdOption,
}: {
  /** PostgreSQL state provider wrapping the database connection. */
  stateProvider: PgStateProvider<TTxContext>;
  /** PostgreSQL schema for all tables. @defaultValue `"public"` */
  schema?: string;
  /** Prefix for all table names. @defaultValue `"queuert_"` */
  tablePrefix?: string;
  /** SQL type for the primary key column. @defaultValue `"uuid"` */
  idType?: string;
  /**
   * Function to generate new job IDs. IDs are generated in JS and bound as a
   * query parameter; the column has no SQL `DEFAULT`.
   *
   * @defaultValue `() => crypto.randomUUID()`
   */
  generateId?: () => TIdType;
  /**
   * Predicate returning `true` if the ID is acceptable. Runs on both generated
   * and caller-supplied IDs; failures throw `InvalidJobIdError`.
   */
  validateId?: (id: TIdType) => boolean;
}): Promise<
  StateAdapter<TTxContext, TIdType> & {
    migrateToLatest: () => Promise<MigrationResult>;
    vacuum: () => Promise<void>;
    truncate: () => Promise<void>;
  }
> => {
  validateSqlIdentifier(schema, "schema");
  validateSqlIdentifier(tablePrefix, "tablePrefix");
  validateSqlIdentifier(idType, "idType");

  let closed = false;

  const { validateId, generateId } = createIdValidator<TIdType>({
    generateIdOption,
    validateIdOption,
  });

  const applyTemplate = createTemplateApplier({
    schema,
    table_prefix: tablePrefix,
    id_type: idType,
  });
  const templateCache = createTemplateCache();

  const idDataType = idType === "uuid" ? t.uuid() : t.string();
  const idNullableDataType = idType === "uuid" ? t["uuid?"]() : t["string?"]();
  const dbJobColumns = {
    id: idDataType,
    chain_id: idDataType,
    type_name: t.string(),
    chain_type_name: t.string(),
    chain_index: t.number(),
    continued_to_id: idNullableDataType,
    input: t.json(),
    output: t.json(),
    blocked: t.boolean(),
    created_at: t.string(),
    scheduled_at: t.string(),
    completed_at: t["string?"](),
    completed_by: t["string?"](),
    attempt: t.number(),
    last_attempt_error: t["json?"]<string>(),
    last_attempt_at: t["string?"](),
    attempt_at: t["string?"](),
    attempt_by: t["string?"](),
    attempt_until: t["string?"](),
    deduplication_key: t["string?"](),
    chain_trace_context: t["string?"](),
    trace_context: t["string?"](),
  } as const;

  const rowToJsonJobColumns = {
    head_job: t.json<DbJob>(),
    tail_job: t["json?"]<DbJob>(),
  } as const;

  const executeTypedSql = async <
    TParams extends readonly DataType[],
    TColumns extends Record<string, DataType>,
  >({
    txCtx,
    sql: typedSql,
    params,
  }: {
    txCtx?: TTxContext;
    sql: TypedSql<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): Promise<InferColumns<TColumns>[]> => {
    return stateProvider.executeSql({
      txCtx,
      id: typedSql.id,
      sql: typedSql.sql,
      params: params ?? [],
      paramTypes: extractParamTypes(typedSql.params),
      columnTypes: extractColumnTypes(typedSql.columns),
      readOnly: typedSql.readOnly,
    }) as Promise<InferColumns<TColumns>[]>;
  };

  const expandChainIds = async (
    txCtx: TTxContext | undefined,
    chainIds: readonly TIdType[],
  ): Promise<TIdType[]> => {
    if (chainIds.length === 0) return [];
    const connected = await executeTypedSql({
      txCtx,
      sql: templateCache.getOrCompute("getConnectedChainIds", () =>
        applyTemplate(
          sql(
            `
WITH RECURSIVE connected(chain_id) AS (
  SELECT unnest($1::{{id_type}}[]) AS chain_id
  UNION
  -- jb.job_id = chain_id because blockers are added to the root job whose id = chain_id
  SELECT jb.blocked_by_chain_id AS chain_id
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  JOIN connected c ON jb.job_id = c.chain_id
)
SELECT chain_id FROM connected
`,
            {
              id: "getConnectedChainIds",
              params: [t.array()],
              columns: { chain_id: idDataType },
              readOnly: true,
            },
          ),
        ),
      ),
      params: [[...chainIds]],
    });
    return connected.map((r) => r.chain_id) as TIdType[];
  };

  return {
    transactionConcurrency: stateProvider.transactionConcurrency,

    withTransaction: stateProvider.withTransaction,

    withSavepoint:
      stateProvider.withSavepoint ??
      (async (txCtx, fn) => {
        const sp = `queuert_sp_${randomUUID().replace(/-/g, "_")}`;
        await executeTypedSql({
          txCtx,
          sql: applyTemplate(
            sql(/* sql */ `SAVEPOINT ${sp}`, { readOnly: true, params: [], columns: {} }),
          ),
        });
        try {
          const result = await fn(txCtx);
          await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(/* sql */ `RELEASE SAVEPOINT ${sp}`, { readOnly: true, params: [], columns: {} }),
            ),
          });
          return result;
        } catch (error) {
          await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(/* sql */ `ROLLBACK TO SAVEPOINT ${sp}`, {
                readOnly: true,
                params: [],
                columns: {},
              }),
            ),
          }).catch(() => {});
          throw error;
        }
      }),

    getChains: async ({
      txCtx,
      chainIds,
      lock,
    }: {
      txCtx?: TTxContext;
      chainIds: TIdType[];
      lock?: "exclusive";
    }) => {
      if (chainIds.length === 0) return [];
      const chainsSelect = (lockClause: string) =>
        `
SELECT
  row_to_json(j)  AS head_job,
  row_to_json(lc) AS tail_job
FROM {{schema}}.{{table_prefix}}job AS j
LEFT JOIN LATERAL (
  SELECT *
  FROM {{schema}}.{{table_prefix}}job
  WHERE chain_id = j.id
  ORDER BY chain_index DESC
  LIMIT 1${lockClause}
) AS lc ON TRUE
WHERE j.id = ANY($1::{{id_type}}[])${lockClause ? "\nORDER BY j.id" : ""}
`;
      const getChainsSql = templateCache.getOrCompute("getChains", () =>
        applyTemplate(
          sql(chainsSelect(""), {
            id: "getChains",
            params: [t.array()],
            columns: rowToJsonJobColumns,
            readOnly: true,
          }),
        ),
      );
      const getChainsLockedSql = templateCache.getOrCompute("getChainsLocked", () =>
        applyTemplate(
          sql(chainsSelect("\n  FOR UPDATE"), {
            id: "getChainsLocked",
            params: [t.array()],
            columns: rowToJsonJobColumns,
          }),
        ),
      );
      const rows = await executeTypedSql({
        txCtx,
        sql: lock === "exclusive" ? getChainsLockedSql : getChainsSql,
        params: [chainIds as string[]],
      });
      return classifyChainRows(chainIds, rows);
    },

    getJobs: (async ({
      txCtx,
      jobIds,
      lock,
    }: {
      txCtx?: TTxContext;
      jobIds: TIdType[];
      lock?: "exclusive";
    }) => {
      if (jobIds.length === 0) return [];
      const getJobsSql = templateCache.getOrCompute("getJobs", () =>
        applyTemplate(
          sql(
            `
SELECT *
FROM {{schema}}.{{table_prefix}}job
WHERE id = ANY($1::{{id_type}}[])
`,
            {
              id: "getJobs",
              params: [t.array()],
              columns: { ...dbJobColumns },
              readOnly: true,
            },
          ),
        ),
      );
      const getJobsLockedSql = templateCache.getOrCompute("getJobsLocked", () =>
        applyTemplate(
          sql(
            `
SELECT *
FROM {{schema}}.{{table_prefix}}job
WHERE id = ANY($1::{{id_type}}[])
ORDER BY id
FOR UPDATE
`,
            {
              id: "getJobsLocked",
              params: [t.array()],
              columns: { ...dbJobColumns },
            },
          ),
        ),
      );
      const rows = await executeTypedSql({
        txCtx,
        sql: lock === "exclusive" ? getJobsLockedSql : getJobsSql,
        params: [jobIds as string[]],
      });
      return classifyJobRows(jobIds, rows);
    }) as StateAdapter<TTxContext, TIdType>["getJobs"],

    createChains: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];

      for (const job of jobs) {
        if (job.id !== undefined) validateId(job.id, "caller");
      }
      const ids = jobs.map((j) => (j.id ?? generateId()) as string);

      const results = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("createChains", () =>
          applyTemplate(
            sql(
              `
WITH generated_ids AS (
  SELECT id, ord
  FROM unnest($1::{{id_type}}[]) WITH ORDINALITY AS t(id, ord)
),
input_data AS (
  SELECT
    gi.id,
    raw.type_name,
    gi.id                AS chain_id,
    raw.chain_type_name,
    0                    AS chain_index,
    raw.input, raw.dedup_key, raw.dedup_scope, raw.dedup_exclude_chain_ids,
    raw.scheduled_at, raw.schedule_after_ms,
    raw.chain_trace_context, raw.trace_context, raw.ord
  FROM unnest(
    $2::text[], $3::text[],
    $4::jsonb[], $5::text[], $6::text[],
    $7::text[],
    $8::timestamptz[], $9::bigint[],
    $10::text[], $11::text[]
  ) WITH ORDINALITY AS raw(
    type_name, chain_type_name,
    input, dedup_key, dedup_scope, dedup_exclude_chain_ids,
    scheduled_at, schedule_after_ms,
    chain_trace_context, trace_context, ord
  )
  JOIN generated_ids gi USING (ord)
),
existing_deduplicated AS (
  SELECT DISTINCT ON (id2.ord) id2.ord, j.*
  FROM input_data id2
  JOIN {{schema}}.{{table_prefix}}job j
    ON id2.dedup_key IS NOT NULL
    AND j.deduplication_key = id2.dedup_key
    AND j.chain_index = 0
    AND j.chain_type_name = id2.chain_type_name
    AND (
      id2.dedup_scope IS NULL
      OR (id2.dedup_scope = 'running' AND NOT EXISTS (
        SELECT 1 FROM {{schema}}.{{table_prefix}}job j2
        WHERE j2.chain_id = j.id AND j2.completed_at IS NOT NULL AND j2.continued_to_id IS NULL
      ))
      OR (id2.dedup_scope = 'any')
    )
    AND (
      id2.dedup_exclude_chain_ids IS NULL
      OR j.chain_id != ALL(ARRAY(SELECT jsonb_array_elements_text(id2.dedup_exclude_chain_ids::jsonb))::{{id_type}}[])
    )
  ORDER BY id2.ord, j.created_at DESC
),
to_insert_all AS (
  SELECT id2.*
  FROM input_data id2
  WHERE NOT EXISTS (SELECT 1 FROM existing_deduplicated ed WHERE ed.ord = id2.ord)
),
to_insert AS (
  SELECT tia.*
  FROM to_insert_all tia
  WHERE tia.dedup_key IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM to_insert_all tia2
      WHERE tia2.dedup_key = tia.dedup_key AND tia2.chain_type_name = tia.chain_type_name AND tia2.ord < tia.ord
    )
),
inserted_jobs AS (
  INSERT INTO {{schema}}.{{table_prefix}}job (id, type_name, chain_id, chain_type_name, chain_index, input, deduplication_key, scheduled_at, chain_trace_context, trace_context)
  SELECT
    ti.id, ti.type_name, ti.chain_id, ti.chain_type_name,
    ti.chain_index, ti.input, ti.dedup_key,
    GREATEST(COALESCE(ti.scheduled_at, now() + (ti.schedule_after_ms || ' milliseconds')::interval, now()), now()),
    ti.chain_trace_context, ti.trace_context
  FROM to_insert ti
  ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = {{schema}}.{{table_prefix}}job.id
  RETURNING *
)
SELECT ed.ord, ed.id, ed.type_name, ed.chain_id, ed.chain_type_name, ed.chain_index, ed.continued_to_id, ed.input, ed.output, ed.blocked, ed.created_at, ed.scheduled_at, ed.completed_at, ed.completed_by, ed.attempt, ed.last_attempt_error, ed.last_attempt_at, ed.attempt_at, ed.attempt_by, ed.attempt_until, ed.deduplication_key, ed.chain_trace_context, ed.trace_context, TRUE AS deduplicated
FROM existing_deduplicated ed
UNION ALL
SELECT tia.ord, ij.id, ij.type_name, ij.chain_id, ij.chain_type_name, ij.chain_index, ij.continued_to_id, ij.input, ij.output, ij.blocked, ij.created_at, ij.scheduled_at, ij.completed_at, ij.completed_by, ij.attempt, ij.last_attempt_error, ij.last_attempt_at, ij.attempt_at, ij.attempt_by, ij.attempt_until, ij.deduplication_key, ij.chain_trace_context, ij.trace_context, TRUE AS deduplicated
FROM to_insert_all tia
JOIN to_insert ti ON ti.dedup_key = tia.dedup_key AND ti.chain_type_name = tia.chain_type_name
JOIN inserted_jobs ij ON ti.chain_id = ij.chain_id AND ti.chain_index = ij.chain_index
WHERE tia.dedup_key IS NOT NULL AND tia.ord != ti.ord
UNION ALL
SELECT ti.ord, ij.id, ij.type_name, ij.chain_id, ij.chain_type_name, ij.chain_index, ij.continued_to_id, ij.input, ij.output, ij.blocked, ij.created_at, ij.scheduled_at, ij.completed_at, ij.completed_by, ij.attempt, ij.last_attempt_error, ij.last_attempt_at, ij.attempt_at, ij.attempt_by, ij.attempt_until, ij.deduplication_key, ij.chain_trace_context, ij.trace_context, (ij.id != ti.id) AS deduplicated
FROM inserted_jobs ij JOIN to_insert ti ON ti.chain_id = ij.chain_id AND ti.chain_index = ij.chain_index
ORDER BY ord
`,
              {
                id: "createChains",
                params: [
                  t.array(),
                  t.array(),
                  t.array<string | null>(),
                  t.jsonArray(),
                  t.array<string | null>(),
                  t.array<string | null>(),
                  t.array<string | null>(),
                  t.array<string | null>(),
                  t.array<number | null>(),
                  t.array<string | null>(),
                  t.array<string | null>(),
                ],
                columns: { ...dbJobColumns, deduplicated: t.boolean(), ord: t.number() },
              },
            ),
          ),
        ),
        params: [
          ids,
          jobs.map((j) => j.typeName),
          jobs.map((j) => j.chainTypeName),
          jobs.map((j) => j.input),
          jobs.map((j) => j.deduplication?.key ?? null),
          jobs.map((j) => (j.deduplication ? j.deduplication.scope : null)),
          jobs.map((j) =>
            j.deduplication?.excludeChainIds
              ? JSON.stringify(j.deduplication.excludeChainIds)
              : null,
          ),
          jobs.map((j) => j.schedule?.at?.toISOString() ?? null),
          jobs.map((j) => j.schedule?.afterMs ?? null),
          jobs.map((j) => j.chainTraceContext ?? null),
          jobs.map((j) => j.traceContext ?? null),
        ],
      });

      return results.map((r) => ({
        job: mapDbJobToStateJob(r),
        deduplicated: r.deduplicated,
      }));
    },

    createContinuationJob: async ({ txCtx, job }) => {
      if (job.id !== undefined) validateId(job.id, "caller");
      const id = (job.id ?? generateId()) as string;

      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("createContinuationJob", () =>
          applyTemplate(
            sql(
              `
WITH parent AS (
  SELECT id, chain_id, chain_type_name, chain_index
  FROM {{schema}}.{{table_prefix}}job
  WHERE id = $3::{{id_type}}
),
existing_continuation AS (
  SELECT j.*
  FROM {{schema}}.{{table_prefix}}job j, parent p
  WHERE j.chain_id = p.chain_id
    AND j.chain_index = p.chain_index + 1
    AND j.id != j.chain_id
  LIMIT 1
),
inserted AS (
  INSERT INTO {{schema}}.{{table_prefix}}job (id, type_name, chain_id, chain_type_name, chain_index, input, scheduled_at, chain_trace_context, trace_context)
  SELECT
    $1::{{id_type}}, $2, p.chain_id, p.chain_type_name, p.chain_index + 1, $4,
    GREATEST(COALESCE($5::timestamptz, now() + ($6::bigint || ' milliseconds')::interval, now()), now()),
    $7, $8
  FROM parent p
  WHERE NOT EXISTS (SELECT 1 FROM existing_continuation)
  ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = {{schema}}.{{table_prefix}}job.id
  RETURNING *
)
SELECT ij.*, (ij.id != $1::{{id_type}}) AS deduplicated FROM inserted ij
UNION ALL
SELECT ec.*, TRUE AS deduplicated FROM existing_continuation ec
`,
              {
                id: "createContinuationJob",
                params: [
                  idDataType,
                  t.string(),
                  idDataType,
                  t.json(),
                  t["string?"](),
                  t["number?"](),
                  t["string?"](),
                  t["string?"](),
                ],
                columns: { ...dbJobColumns, deduplicated: t.boolean() },
              },
            ),
          ),
        ),
        params: [
          id,
          job.typeName,
          job.continueFromId,
          job.input,
          job.schedule?.at?.toISOString() ?? null,
          job.schedule?.afterMs ?? null,
          job.chainTraceContext ?? null,
          job.traceContext ?? null,
        ],
      });

      if (!result) {
        throw new Error(`continueWith parent job ${job.continueFromId} not found`);
      }

      return { job: mapDbJobToStateJob(result), deduplicated: result.deduplicated };
    },

    addJobsBlockers: async ({ txCtx, jobBlockers }) => {
      if (jobBlockers.length === 0) return [];

      const flatJobIds: string[] = [];
      const flatBlockedByChainIds: string[] = [];
      const flatTraceContexts: (string | null)[] = [];
      const flatIndexes: number[] = [];

      for (const entry of jobBlockers) {
        entry.blockedByChainIds.forEach((chainId, i) => {
          flatJobIds.push(entry.jobId);
          flatBlockedByChainIds.push(chainId);
          flatTraceContexts.push(entry.blockerTraceContexts?.[i] ?? null);
          flatIndexes.push(i);
        });
      }

      const results = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("addJobsBlockers", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT job_id, blocked_by_chain_id, trace_context, blocker_index AS "index", ord
  FROM unnest($1::{{id_type}}[], $2::{{id_type}}[], $3::text[], $4::integer[]) WITH ORDINALITY AS t(job_id, blocked_by_chain_id, trace_context, blocker_index, ord)
),
locked_blocker_chain_latest AS (
  SELECT j.id, j.chain_id, j.completed_at, j.continued_to_id
  FROM {{schema}}.{{table_prefix}}job j
  WHERE j.chain_id IN (SELECT DISTINCT blocked_by_chain_id FROM input_data)
    AND NOT EXISTS (
      SELECT 1 FROM {{schema}}.{{table_prefix}}job j2
      WHERE j2.chain_id = j.chain_id AND j2.chain_index > j.chain_index
    )
  ORDER BY j.id
  FOR UPDATE
),
inserted_blockers AS (
  INSERT INTO {{schema}}.{{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
  SELECT job_id, blocked_by_chain_id, "index", trace_context
  FROM input_data
  RETURNING job_id, blocked_by_chain_id
),
blockers_status AS (
  SELECT
    ib.job_id,
    ib.blocked_by_chain_id,
    (lbcl.completed_at IS NOT NULL AND lbcl.continued_to_id IS NULL) AS blocker_complete
  FROM inserted_blockers ib
  LEFT JOIN locked_blocker_chain_latest lbcl ON lbcl.chain_id = ib.blocked_by_chain_id
),
has_incomplete_blockers AS (
  SELECT DISTINCT job_id
  FROM blockers_status
  WHERE blocker_complete IS NOT TRUE
),
updated_jobs AS (
  UPDATE {{schema}}.{{table_prefix}}job j
  SET blocked = true
  WHERE j.id IN (SELECT job_id FROM has_incomplete_blockers)
    AND j.completed_at IS NULL
    AND j.attempt_at IS NULL
    AND j.blocked = false
  RETURNING j.*
),
distinct_job_ids AS (
  SELECT DISTINCT job_id FROM input_data
),
final_jobs AS (
  SELECT * FROM updated_jobs
  UNION ALL
  SELECT j.* FROM {{schema}}.{{table_prefix}}job j
  JOIN distinct_job_ids dj ON dj.job_id = j.id
  WHERE NOT EXISTS (SELECT 1 FROM updated_jobs uj WHERE uj.id = j.id)
),
per_job_incomplete AS (
  SELECT
    bs.job_id,
    COALESCE(array_agg(bs.blocked_by_chain_id) FILTER (WHERE bs.blocker_complete IS NOT TRUE), ARRAY[]::{{id_type}}[]) AS incomplete_blocker_chain_ids
  FROM blockers_status bs
  GROUP BY bs.job_id
),
per_job_trace_contexts AS (
  SELECT
    id2.job_id,
    json_agg(j.chain_trace_context ORDER BY id2.ord) AS blocker_chain_trace_contexts
  FROM input_data id2
  JOIN {{schema}}.{{table_prefix}}job j ON j.id = id2.blocked_by_chain_id
  GROUP BY id2.job_id
)
SELECT fj.*,
  fj.id AS source_job_id,
  COALESCE(pi.incomplete_blocker_chain_ids, ARRAY[]::{{id_type}}[]) AS incomplete_blocker_chain_ids,
  COALESCE(ptc.blocker_chain_trace_contexts, '[]'::json) AS blocker_chain_trace_contexts
FROM final_jobs fj
LEFT JOIN per_job_incomplete pi ON pi.job_id = fj.id
LEFT JOIN per_job_trace_contexts ptc ON ptc.job_id = fj.id
ORDER BY fj.id
`,
              {
                id: "addJobsBlockers",
                params: [t.array(), t.array(), t.array<string | null>(), t.array<number>()],
                columns: {
                  ...dbJobColumns,
                  source_job_id: idDataType,
                  incomplete_blocker_chain_ids: t.array(),
                  blocker_chain_trace_contexts: t.json<(string | null)[]>(),
                },
              },
            ),
          ),
        ),
        params: [flatJobIds, flatBlockedByChainIds, flatTraceContexts, flatIndexes],
      });

      const resultMap = new Map(
        results.map((r) => [
          r.source_job_id,
          {
            job: mapDbJobToStateJob(r),
            incompleteBlockerChainIds: r.incomplete_blocker_chain_ids,
            blockerChainTraceContexts: r.blocker_chain_trace_contexts,
          },
        ]),
      );

      return jobBlockers.map((entry) => {
        const result = resultMap.get(entry.jobId);
        if (!result) throw new Error(`Missing blocker result for job ${entry.jobId}`);
        return result;
      });
    },

    getJobBlockers: async ({ txCtx, jobId }) => {
      const chains = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getJobBlockers", () =>
          applyTemplate(
            sql(
              `
SELECT
  row_to_json(j)   AS head_job,
  row_to_json(lc)  AS tail_job
FROM {{schema}}.{{table_prefix}}job_blocker AS b
JOIN {{schema}}.{{table_prefix}}job AS j
  ON j.id = b.blocked_by_chain_id
LEFT JOIN LATERAL (
  SELECT *
  FROM {{schema}}.{{table_prefix}}job
  WHERE chain_id = j.id
  ORDER BY chain_index DESC
  LIMIT 1
) AS lc ON TRUE
WHERE b.job_id = $1
ORDER BY b.index ASC
`,
              {
                id: "getJobBlockers",
                params: [idDataType],
                columns: rowToJsonJobColumns,
                readOnly: true,
              },
            ),
          ),
        ),
        params: [jobId],
      });

      return chains.map(({ head_job, tail_job }) => [
        mapDbJobToStateJob(head_job),
        tail_job ? mapDbJobToStateJob(tail_job) : undefined,
      ]);
    },

    unblockJobs: async ({ txCtx, blockedByChainId }) => {
      await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("lockBlockedJobs", () =>
          applyTemplate(
            sql(
              `
SELECT j.id
FROM {{schema}}.{{table_prefix}}job j
WHERE j.id IN (
  SELECT DISTINCT jb.job_id
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.blocked_by_chain_id = $1
)
AND j.blocked = true
ORDER BY j.id
FOR UPDATE
`,
              {
                id: "lockBlockedJobs",
                params: [idDataType],
                columns: { id: idDataType },
              },
            ),
          ),
        ),
        params: [blockedByChainId],
      });

      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("unblockJobs", () =>
          applyTemplate(
            sql(
              `
WITH direct_blocked AS (
  SELECT DISTINCT jb.job_id
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.blocked_by_chain_id = $1
),
blockers_status AS (
  SELECT
    jb.job_id,
    jb.blocked_by_chain_id,
    EXISTS (
      SELECT 1 FROM {{schema}}.{{table_prefix}}job j2
      WHERE j2.chain_id = jb.blocked_by_chain_id
        AND j2.continued_to_id IS NULL AND j2.completed_at IS NOT NULL
    ) AS blocker_complete
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.job_id IN (SELECT job_id FROM direct_blocked)
),
ready_jobs AS (
  SELECT job_id
  FROM blockers_status
  GROUP BY job_id
  HAVING bool_and(COALESCE(blocker_complete, false))
),
updated AS (
  UPDATE {{schema}}.{{table_prefix}}job j
  SET scheduled_at = GREATEST(j.scheduled_at, now()),
    blocked = false
  WHERE j.id IN (SELECT job_id FROM ready_jobs)
    AND j.blocked = true
  RETURNING j.*
),
trace_contexts AS (
  SELECT jb.trace_context
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.blocked_by_chain_id = $1
    AND jb.trace_context IS NOT NULL
)
SELECT
  COALESCE((SELECT json_agg(row_to_json(u)) FROM updated u), '[]'::json) AS unblocked_jobs,
  COALESCE((SELECT json_agg(tc.trace_context) FROM trace_contexts tc), '[]'::json) AS blocker_trace_contexts;
`,
              {
                id: "unblockJobs",
                params: [idDataType],
                columns: {
                  unblocked_jobs: t.json<DbJob[]>(),
                  blocker_trace_contexts: t.json<(string | null)[]>(),
                },
              },
            ),
          ),
        ),
        params: [blockedByChainId],
      });
      return {
        unblockedJobs: result.unblocked_jobs.map(mapDbJobToStateJob),
        blockerTraceContexts: result.blocker_trace_contexts,
      };
    },

    startJobAttempt: async ({ txCtx, typeNames, workerId }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("startJobAttempt", () =>
          applyTemplate(
            sql(
              `
WITH acquired_job AS (
  SELECT j.id
  FROM (SELECT type_name FROM unnest($1::text[]) AS u(type_name) ORDER BY random()) AS t
  CROSS JOIN LATERAL (
    SELECT id
    FROM {{schema}}.{{table_prefix}}job
    WHERE type_name = t.type_name
      AND blocked = false
      AND attempt_at IS NULL
      AND completed_at IS NULL
      AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ) j
  LIMIT 1
)
UPDATE {{schema}}.{{table_prefix}}job
SET attempt = attempt + 1,
  attempt_at = now(),
  attempt_by = $2
WHERE id = (SELECT id FROM acquired_job)
RETURNING *
`,
              {
                id: "startJobAttempt",
                params: [t.array(), t.string()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [typeNames, workerId],
      });

      return { job: result ? mapDbJobToStateJob(result) : undefined };
    },
    extendJobAttempt: async ({ txCtx, jobId, workerId, timeoutMs }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("extendJobAttempt", () =>
          applyTemplate(
            sql(
              `
UPDATE {{schema}}.{{table_prefix}}job
SET attempt_until = now() + ($3::bigint || ' milliseconds')::interval
WHERE id = $1
  AND attempt_by = $2
RETURNING *
`,
              {
                id: "extendJobAttempt",
                params: [idDataType, t.string(), t.number()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [jobId, workerId, timeoutMs],
      });

      return mapDbJobToStateJob(job);
    },

    finishJobAttempt: async ({ txCtx, jobId, workerId, outcome }) => {
      if (outcome.error !== undefined) {
        const [job] = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("finishJobAttemptFailed", () =>
            applyTemplate(
              sql(
                `
UPDATE {{schema}}.{{table_prefix}}job
SET last_attempt_at = now(),
  last_attempt_error = $2::jsonb,
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL,
  scheduled_at = GREATEST(COALESCE($3::timestamptz, now() + ($4::bigint || ' milliseconds')::interval, now()), now())
WHERE id = $1
  AND attempt_by = $5
RETURNING *
`,
                {
                  id: "finishJobAttemptFailed",
                  params: [idDataType, t.string(), t["date?"](), t["number?"](), t["string?"]()],
                  columns: { ...dbJobColumns },
                },
              ),
            ),
          ),
          params: [
            jobId,
            JSON.stringify(outcome.error),
            outcome.schedule?.at?.toISOString() ?? null,
            outcome.schedule?.afterMs ?? null,
            workerId,
          ],
        });

        return mapDbJobToStateJob(job);
      }

      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("finishJobAttemptCompleted", () =>
          applyTemplate(
            sql(
              `
UPDATE {{schema}}.{{table_prefix}}job
SET completed_at = now(),
  completed_by = $3,
  output = $2::jsonb,
  continued_to_id = $4::{{id_type}},
  blocked = false,
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL,
  last_attempt_error = NULL
WHERE id = $1
  AND completed_at IS NULL
RETURNING *
`,
              {
                id: "finishJobAttemptCompleted",
                params: [idDataType, t["string?"](), t["string?"](), idNullableDataType],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [
          jobId,
          outcome.continuedToId != null || outcome.output === undefined
            ? null
            : JSON.stringify(outcome.output),
          workerId,
          outcome.continuedToId ?? null,
        ],
      });

      return mapDbJobToStateJob(job);
    },

    reclaimExpiredJobAttempt: async ({ txCtx, typeNames, ignoredJobIds }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("reclaimExpiredJobAttempt", () =>
          applyTemplate(
            sql(
              `
WITH job_to_unlock AS (
  SELECT j.id
  FROM (SELECT type_name FROM unnest($1::text[]) AS u(type_name) ORDER BY random()) AS t
  CROSS JOIN LATERAL (
    SELECT id
    FROM {{schema}}.{{table_prefix}}job
    WHERE type_name = t.type_name
      AND attempt_at IS NOT NULL
      AND attempt_until IS NOT NULL
      AND attempt_until <= now()
      AND completed_at IS NULL
      AND id != ALL($2::{{id_type}}[])
    ORDER BY attempt_until ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ) j
  LIMIT 1
)
UPDATE {{schema}}.{{table_prefix}}job as job
SET attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL
FROM job_to_unlock
WHERE job.id = job_to_unlock.id
RETURNING job.*
`,
              {
                id: "reclaimExpiredJobAttempt",
                params: [t.array(), t.array()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [typeNames, ignoredJobIds ?? []],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },

    getStartAttemptDelayMs: async ({ txCtx, typeNames }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getStartAttemptDelayMs", () =>
          applyTemplate(
            sql(
              `
WITH due AS (
  SELECT j.id
  FROM (SELECT type_name FROM unnest($1::text[]) AS u(type_name) ORDER BY random()) AS t
  CROSS JOIN LATERAL (
    SELECT id
    FROM {{schema}}.{{table_prefix}}job
    WHERE type_name = t.type_name
      AND blocked = false
      AND attempt_at IS NULL
      AND completed_at IS NULL
      AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ) j
  LIMIT 1
),
upcoming AS (
  SELECT j.scheduled_at
  FROM unnest($1::text[]) AS t(type_name)
  CROSS JOIN LATERAL (
    SELECT scheduled_at
    FROM {{schema}}.{{table_prefix}}job
    WHERE type_name = t.type_name
      AND blocked = false
      AND attempt_at IS NULL
      AND completed_at IS NULL
      AND scheduled_at > now()
    ORDER BY scheduled_at ASC
    LIMIT 1
  ) j
  ORDER BY j.scheduled_at ASC
  LIMIT 1
)
SELECT delay_ms
FROM (
  SELECT COALESCE(
    (SELECT 0 FROM due LIMIT 1),
    (SELECT CEIL(EXTRACT(EPOCH FROM (scheduled_at - now())) * 1000)::integer FROM upcoming)
  ) AS delay_ms
) d
WHERE delay_ms IS NOT NULL
`,
              {
                id: "getStartAttemptDelayMs",
                params: [t.array()],
                columns: { delay_ms: t.number() },
              },
            ),
          ),
        ),
        params: [typeNames],
      });
      return result ? result.delay_ms : null;
    },

    rescheduleJobs: async ({ txCtx, jobIds, schedule }) => {
      if (jobIds.length === 0) return [];
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("rescheduleJobs", () =>
          applyTemplate(
            sql(
              `
UPDATE {{schema}}.{{table_prefix}}job
SET scheduled_at = GREATEST(COALESCE($2::timestamptz, now() + ($3::bigint || ' milliseconds')::interval, now()), now())
WHERE id = ANY($1::{{id_type}}[])
  AND completed_at IS NULL
  AND attempt_at IS NULL
RETURNING *
`,
              {
                id: "rescheduleJobs",
                params: [t.array(), t["date?"](), t["number?"]()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [
          jobIds as string[],
          schedule?.at?.toISOString() ?? null,
          schedule?.afterMs ?? null,
        ],
      });
      const orderById = new Map(jobIds.map((id, i) => [id as string, i]));
      return rows
        .slice()
        .sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!)
        .map(mapDbJobToStateJob);
    },

    deleteChains: async ({ txCtx, chainIds, cascade }) => {
      const effectiveChainIds = cascade ? await expandChainIds(txCtx, chainIds) : chainIds;
      if (effectiveChainIds.length === 0) return { deleted: [], blockerRefs: [] };
      const [row] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("deleteChains", () =>
          applyTemplate(
            sql(
              `
WITH _locked AS (
  -- Lock all jobs in chains being deleted before checking external refs, so
  -- the check and DELETE see the same state even under concurrency.
  SELECT id FROM {{schema}}.{{table_prefix}}job
  WHERE chain_id = ANY($1::{{id_type}}[])
  ORDER BY ctid
  FOR UPDATE
),
_external_refs AS (
  SELECT jb.job_id, jb.blocked_by_chain_id
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  JOIN {{schema}}.{{table_prefix}}job j ON j.id = jb.job_id
  WHERE jb.blocked_by_chain_id = ANY($1::{{id_type}}[])
    AND j.chain_id != ALL($1::{{id_type}}[])
),
_deleted_blockers AS (
  DELETE FROM {{schema}}.{{table_prefix}}job_blocker
  WHERE job_id IN (SELECT id FROM _locked)
    AND NOT EXISTS (SELECT 1 FROM _external_refs)
),
_deleted_jobs AS (
  DELETE FROM {{schema}}.{{table_prefix}}job
  WHERE id IN (SELECT id FROM _locked)
    AND NOT EXISTS (SELECT 1 FROM _external_refs)
  RETURNING *
),
_deleted_pairs AS (
  SELECT
    row_to_json(root) AS head_job,
    row_to_json(lc) AS tail_job
  FROM (SELECT * FROM _deleted_jobs WHERE chain_index = 0) AS root
  LEFT JOIN LATERAL (
    SELECT *
    FROM _deleted_jobs
    WHERE chain_id = root.id
    ORDER BY chain_index DESC
    LIMIT 1
  ) AS lc ON TRUE
)
SELECT
  COALESCE((SELECT json_agg(row_to_json(p)) FROM _deleted_pairs p), '[]'::json) AS deleted,
  COALESCE((SELECT json_agg(row_to_json(r)) FROM _external_refs r), '[]'::json) AS blocker_refs
`,
              {
                id: "deleteChains",
                params: [t.array()],
                columns: {
                  deleted: t.json<{ head_job: DbJob; tail_job: DbJob | null }[]>(),
                  blocker_refs: t.json<{ job_id: string; blocked_by_chain_id: string }[]>(),
                },
              },
            ),
          ),
        ),
        params: [effectiveChainIds],
      });
      return {
        deleted: row.deleted.map((pair): [StateJob, StateJob | undefined] => [
          mapDbJobToStateJob(pair.head_job),
          pair.tail_job && pair.tail_job.id !== pair.head_job.id
            ? mapDbJobToStateJob(pair.tail_job)
            : undefined,
        ]),
        blockerRefs: row.blocker_refs.map((r) => ({
          chainId: r.blocked_by_chain_id,
          referencedByJobId: r.job_id,
        })),
      };
    },

    listChains: async ({
      txCtx,
      typeName,
      independent,
      chainId,
      from,
      to,
      status,
      orderBy,
      orderDirection,
      page,
    }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, orderBy) : null;
      const conditions: string[] = [];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];
      let p = 1;
      const cmp = orderDirection === "desc" ? "<" : ">";
      const dir = orderDirection === "desc" ? "DESC" : "ASC";

      const addTypeName = (alias: string) => {
        if (typeName?.length) {
          conditions.push(`${alias}.type_name = ANY($${p}::text[])`);
          params.push(typeName);
          paramTypes.push(t.array());
          p++;
        }
      };
      const addChainId = (alias: string) => {
        if (chainId?.length) {
          conditions.push(`${alias}.chain_id = ANY($${p}::${idType}[])`);
          params.push(chainId);
          paramTypes.push(t.array());
          p++;
        }
      };
      const addIndependent = (alias: string) => {
        if (independent === true) {
          conditions.push(
            `NOT EXISTS (SELECT 1 FROM ${schema}.${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = ${alias}.chain_id)`,
          );
        } else if (independent === false) {
          conditions.push(
            `EXISTS (SELECT 1 FROM ${schema}.${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = ${alias}.chain_id)`,
          );
        }
      };
      const addDateRange = (alias: string) => {
        if (from) {
          conditions.push(`${alias}.created_at >= $${p}::timestamptz`);
          params.push(from);
          paramTypes.push(t["date?"]());
          p++;
        }
        if (to) {
          conditions.push(`${alias}.created_at <= $${p}::timestamptz`);
          params.push(to);
          paramTypes.push(t["date?"]());
          p++;
        }
      };

      let sqlStr: string;

      if (status === "running") {
        // Drive from chain tails WHERE continued_to_id IS NULL AND completed_at IS NULL
        conditions.push("tail.continued_to_id IS NULL", "tail.completed_at IS NULL");
        addTypeName("root");
        addChainId("root");
        addIndependent("root");
        addDateRange("root");
        if (cursor) {
          conditions.push(
            `(root.created_at ${cmp} $${p}::timestamptz OR (root.created_at = $${p}::timestamptz AND root.id ${cmp} $${p + 1}::${idType}))`,
          );
          params.push(cursor.value, cursor.id);
          paramTypes.push(t["date?"](), idDataType);
          p += 2;
        }
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        sqlStr = `SELECT row_to_json(root) AS head_job, row_to_json(tail) AS tail_job FROM ${schema}.${tablePrefix}job tail JOIN ${schema}.${tablePrefix}job root ON root.id = tail.chain_id WHERE ${conditions.join(" AND ")} ORDER BY root.created_at ${dir}, root.id ${dir} LIMIT $${p}`;
      } else if (status === "completed" && orderBy === "completedAt") {
        // Drive from job_completed_idx (completed tails in completed_at order)
        conditions.push("tail.continued_to_id IS NULL", "tail.completed_at IS NOT NULL");
        addTypeName("root");
        addChainId("root");
        addIndependent("root");
        addDateRange("root");
        if (cursor) {
          conditions.push(
            `(tail.completed_at ${cmp} $${p}::timestamptz OR (tail.completed_at = $${p}::timestamptz AND root.id ${cmp} $${p + 1}::${idType}))`,
          );
          params.push(cursor.value, cursor.id);
          paramTypes.push(t["date?"](), idDataType);
          p += 2;
        }
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        sqlStr = `SELECT row_to_json(root) AS head_job, row_to_json(tail) AS tail_job FROM ${schema}.${tablePrefix}job tail JOIN ${schema}.${tablePrefix}job root ON root.id = tail.chain_id WHERE ${conditions.join(" AND ")} ORDER BY tail.completed_at ${dir}, root.id ${dir} LIMIT $${p}`;
      } else {
        // No status or completed+createdAt: drive from chain_head_idx (roots in created_at order)
        conditions.push("head_job.chain_index = 0");
        addTypeName("head_job");
        addChainId("head_job");
        addIndependent("head_job");
        addDateRange("head_job");
        if (status === "completed") {
          conditions.push("tail_job.completed_at IS NOT NULL AND tail_job.continued_to_id IS NULL");
        }
        if (cursor) {
          conditions.push(
            `(head_job.created_at ${cmp} $${p}::timestamptz OR (head_job.created_at = $${p}::timestamptz AND head_job.id ${cmp} $${p + 1}::${idType}))`,
          );
          params.push(cursor.value, cursor.id);
          paramTypes.push(t["date?"](), idDataType);
          p += 2;
        }
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        sqlStr = `SELECT row_to_json(head_job) AS head_job, row_to_json(tail_job) AS tail_job FROM ${schema}.${tablePrefix}job head_job LEFT JOIN LATERAL (SELECT * FROM ${schema}.${tablePrefix}job WHERE chain_id = head_job.id ORDER BY chain_index DESC LIMIT 1) tail_job ON TRUE WHERE ${conditions.join(" AND ")} ORDER BY head_job.created_at ${dir}, head_job.id ${dir} LIMIT $${p}`;
      }

      const rows = await executeTypedSql({
        txCtx,
        sql: applyTemplate(
          sql(sqlStr, {
            params: paramTypes,
            columns: rowToJsonJobColumns,
            readOnly: true,
          }),
        ),
        params,
      });

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;

      const items: [StateJob, StateJob | undefined][] = pageRows.map((row) => {
        const headJob = mapDbJobToStateJob(row.head_job);
        const tailJob =
          row.tail_job && row.tail_job.id !== row.head_job.id
            ? mapDbJobToStateJob(row.tail_job)
            : undefined;
        return [headJob, tailJob];
      });

      const lastItem = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastItem) {
        if (status === "completed" && orderBy === "completedAt") {
          nextCursor = encodeCursor({
            type: "timestampWithId",
            sortKey: "completedAt",
            value: lastItem.tail_job!.completed_at!,
            id: lastItem.head_job.id,
          });
        } else {
          nextCursor = encodeCursor({
            type: "timestampWithId",
            sortKey: "createdAt",
            value: lastItem.head_job.created_at,
            id: lastItem.head_job.id,
          });
        }
      }

      return { items, nextCursor };
    },

    listJobs: async (listJobsParams) => {
      const {
        txCtx,
        typeName,
        chainTypeName,
        chainId,
        jobId,
        from,
        to,
        orderBy,
        orderDirection,
        page,
      } = listJobsParams;
      const status = listJobsParams.status;
      const blocked =
        status === "pending" ? (listJobsParams as { blocked?: boolean }).blocked : undefined;
      const continued =
        status === "completed" ? (listJobsParams as { continued?: boolean }).continued : undefined;

      const sqlColumn = {
        createdAt: "created_at",
        scheduledAt: "scheduled_at",
        completedAt: "completed_at",
        attemptAt: "attempt_at",
        attemptUntil: "attempt_until",
      }[orderBy];

      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, orderBy) : null;
      const conditions: string[] = [];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];
      let p = 1;

      // Status-based WHERE additions
      if (status === "pending") {
        conditions.push("j.attempt_at IS NULL AND j.completed_at IS NULL");
        if (blocked === true) {
          conditions.push("j.blocked = true");
        } else if (blocked === false) {
          conditions.push("j.blocked = false");
        }
      } else if (status === "running") {
        conditions.push("j.attempt_at IS NOT NULL AND j.completed_at IS NULL");
      } else if (status === "completed") {
        conditions.push("j.completed_at IS NOT NULL");
        if (continued === true) {
          conditions.push("j.continued_to_id IS NOT NULL");
        } else if (continued === false) {
          conditions.push("j.continued_to_id IS NULL");
        }
      }

      if (typeName?.length) {
        conditions.push(`j.type_name = ANY($${p}::text[])`);
        params.push(typeName);
        paramTypes.push(t.array());
        p++;
      }
      if (chainTypeName?.length) {
        conditions.push(`j.chain_type_name = ANY($${p}::text[])`);
        params.push(chainTypeName);
        paramTypes.push(t.array());
        p++;
      }
      if (chainId?.length) {
        conditions.push(`j.chain_id = ANY($${p}::${idType}[])`);
        params.push(chainId);
        paramTypes.push(t.array());
        p++;
      }
      if (jobId?.length) {
        conditions.push(`j.id = ANY($${p}::${idType}[])`);
        params.push(jobId);
        paramTypes.push(t.array());
        p++;
      }
      if (from) {
        conditions.push(`j.created_at >= $${p}::timestamptz`);
        params.push(from);
        paramTypes.push(t["date?"]());
        p++;
      }
      if (to) {
        conditions.push(`j.created_at <= $${p}::timestamptz`);
        params.push(to);
        paramTypes.push(t["date?"]());
        p++;
      }

      const cmp = orderDirection === "desc" ? "<" : ">";
      if (cursor) {
        conditions.push(
          `(j.${sqlColumn} ${cmp} $${p}::timestamptz OR (j.${sqlColumn} = $${p}::timestamptz AND j.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.value, cursor.id);
        paramTypes.push(t["date?"](), idDataType);
        p += 2;
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const dir = orderDirection === "desc" ? "DESC" : "ASC";
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j ${where} ORDER BY j.${sqlColumn} ${dir}, j.id ${dir} LIMIT $${p}`;

      const rows = await executeTypedSql({
        txCtx,
        sql: applyTemplate(
          sql(sqlStr, {
            params: paramTypes,
            columns: dbJobColumns,
            readOnly: true,
          }),
        ),
        params,
      });

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobToStateJob);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({
          type: "timestampWithId",
          sortKey: orderBy,
          value: lastRow[sqlColumn as keyof DbJob] as string,
          id: lastRow.id,
        });
      }

      return { items, nextCursor };
    },

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeIdCursor(page.cursor) : null;
      const dir = orderDirection === "asc" ? "ASC" : "DESC";
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [idDataType];
      let sqlStr: string;

      if (cursor) {
        const cmp = orderDirection === "asc" ? ">" : "<";
        params.push(cursor.id, page.limit + 1);
        paramTypes.push(idDataType, t.number());
        sqlStr = `WITH start_row AS (
          SELECT c.chain_index AS sc
          FROM ${schema}.${tablePrefix}job c
          WHERE c.id = $2::${idType} AND c.chain_id = $1::${idType}
        )
        SELECT j.* FROM ${schema}.${tablePrefix}job j, start_row s
        WHERE j.chain_id = $1::${idType}
          AND j.chain_index ${cmp} s.sc
        ORDER BY j.chain_index ${dir}, j.id ${dir}
        LIMIT $3::integer`;
      } else {
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j
        WHERE j.chain_id = $1::${idType}
        ORDER BY j.chain_index ${dir}, j.id ${dir}
        LIMIT $2::integer`;
      }

      const rows = await executeTypedSql({
        txCtx,
        sql: applyTemplate(
          sql(sqlStr, {
            params: paramTypes,
            columns: dbJobColumns,
            readOnly: true,
          }),
        ),
        params,
      });

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobToStateJob);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({ type: "id", id: lastRow.id });
      }

      return { items, nextCursor };
    },

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, "createdAt") : null;
      const conditions: string[] = [
        `j.id IN (SELECT jb.job_id FROM ${schema}.${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = $1::${idType})`,
      ];
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [idDataType];
      let p = 2;

      const cmp = orderDirection === "desc" ? "<" : ">";
      if (cursor) {
        conditions.push(
          `(j.created_at ${cmp} $${p}::timestamptz OR (j.created_at = $${p}::timestamptz AND j.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.value, cursor.id);
        paramTypes.push(t["date?"](), idDataType);
        p += 2;
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const dir = orderDirection === "desc" ? "DESC" : "ASC";
      const sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${dir}, j.id ${dir} LIMIT $${p}`;

      const rows = await executeTypedSql({
        txCtx,
        sql: applyTemplate(
          sql(sqlStr, {
            params: paramTypes,
            columns: dbJobColumns,
            readOnly: true,
          }),
        ),
        params,
      });

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobToStateJob);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({
          type: "timestampWithId",
          sortKey: "createdAt",
          value: lastRow.created_at,
          id: lastRow.id,
        });
      }

      return { items, nextCursor };
    },

    migrateToLatest: async () => {
      return createMigrator<TTxContext>({
        migrations,
        store: createMigrationStore(stateProvider, applyTemplate),
      }).migrateToLatest();
    },

    vacuum: async () => {
      await executeTypedSql({
        sql: applyTemplate(
          sql(/* sql */ `VACUUM ${schema}.${tablePrefix}job`, { params: [], columns: {} }),
        ),
      });
      await executeTypedSql({
        sql: applyTemplate(
          sql(/* sql */ `VACUUM ${schema}.${tablePrefix}job_blocker`, { params: [], columns: {} }),
        ),
      });
    },

    truncate: async () => {
      await executeTypedSql({
        sql: applyTemplate(
          sql(
            /* sql */ `TRUNCATE ${schema}.${tablePrefix}job_blocker, ${schema}.${tablePrefix}job CASCADE`,
            {
              params: [],
              columns: {},
            },
          ),
        ),
      });
    },

    close: async () => {
      if (closed) return;
      closed = true;
      await stateProvider.close?.();
    },
  };
};

/**
 * PostgreSQL state adapter type. Includes `migrateToLatest` for schema
 * migrations, `vacuum` for on-demand dead tuple reclamation, and `truncate` for
 * clearing all job data.
 */
export type PgStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
> = StateAdapter<TTxContext, TJobId> & {
  migrateToLatest: () => Promise<MigrationResult>;
  vacuum: () => Promise<void>;
  truncate: () => Promise<void>;
};
