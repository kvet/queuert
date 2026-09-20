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
  type StateBlockedJob,
  type StateChain,
  type StateChainInfo,
  type StateChainStatus,
  type StateJob,
  type StateJobInfo,
  type StateJobStatus,
  createIdValidator,
  decodeIdCursor,
  decodeTimestampWithIdCursor,
  encodeCursor,
} from "queuert/internal";

import { type PgStateProvider } from "../state-provider/state-provider.pg.js";
import { createLegacyUpgrade } from "./legacy-upgrade.pg.js";

type DbJob = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_index: number;
  continued_to_id: string | null;

  input: unknown;
  output: unknown;

  status: string;
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

  chain_status: string | null;
  chain_completed_at: string | null;
  chain_deduplication_key: string | null;

  chain_trace_context: string | null;
  trace_context: string | null;
};

type DbChainColumns = {
  c_type_name: string | null;
  c_status: string | null;
  c_created_at: string | null;
  c_completed_at: string | null;
  c_deduplication_key: string | null;
  c_trace_context: string | null;
};

export const migrations: Migration[] = [
  {
    name: "001_initial_schema",
    type: "transactional",
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

  id                            {{id_type}} PRIMARY KEY,
  chain_id                      {{id_type}} NOT NULL,
  continued_to_id               {{id_type}},

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
  job_id                        {{id_type}} NOT NULL,
  blocked_by_chain_id           {{id_type}} NOT NULL,
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

const COUNT_CAP = 10000;

const jobStatusConditions: Record<StateJobStatus, string> = {
  blocked: "j.status = 'blocked'",
  pending: "j.status = 'pending'",
  running: "j.status = 'running'",
  completed: "j.status = 'completed'",
};
const chainStatusConditions: Record<StateChainStatus, string> = {
  running: "head_job.chain_status = 'running'",
  completed: "head_job.chain_status = 'completed'",
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

const mapDbJobToStateJobInfo = (dbJob: DbJob): StateJobInfo => {
  return {
    id: dbJob.id,
    typeName: dbJob.type_name,
    chainId: dbJob.chain_id,
    chainIndex: dbJob.chain_index,
    continuedToId: dbJob.continued_to_id,
    input: dbJob.input,
    output: dbJob.output,

    status: dbJob.status as StateJobStatus,
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

    traceContext: dbJob.trace_context,
  };
};

const mapDbHeadToStateChainInfo = (head: DbJob): StateChainInfo => ({
  id: head.id,
  typeName: head.type_name,
  status: head.chain_status as StateChainStatus,
  deduplicationKey: head.chain_deduplication_key,
  createdAt: new Date(head.created_at),
  completedAt: head.chain_completed_at ? new Date(head.chain_completed_at) : null,
  traceContext: head.chain_trace_context,
});

const mapDbChainColumns = (chainId: string, row: DbChainColumns): StateChainInfo => ({
  id: chainId,
  typeName: row.c_type_name!,
  status: row.c_status as StateChainStatus,
  deduplicationKey: row.c_deduplication_key,
  createdAt: new Date(row.c_created_at!),
  completedAt: row.c_completed_at ? new Date(row.c_completed_at) : null,
  traceContext: row.c_trace_context,
});

const mapDbJobRowToStateJob = (row: DbJob & DbChainColumns): StateJob => ({
  ...mapDbJobToStateJobInfo(row),
  chain: mapDbChainColumns(row.chain_id, row),
});

const mapDbChainRowToStateChain = (row: DbChainRow): StateChain => ({
  ...mapDbHeadToStateChainInfo(row.head_job),
  head: mapDbJobToStateJobInfo(row.head_job),
  tail: row.tail_job ? mapDbJobToStateJobInfo(row.tail_job) : undefined,
});

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
   * Function to generate new job IDs. Must return unique values — collisions
   * are a hard error (the unique constraint rejects duplicates).
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
    chain_index: t.number(),
    continued_to_id: idNullableDataType,
    input: t.json(),
    output: t.json(),
    status: t.string(),
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
    chain_status: t["string?"](),
    chain_completed_at: t["string?"](),
    chain_deduplication_key: t["string?"](),
    chain_trace_context: t["string?"](),
    trace_context: t["string?"](),
  } as const;

  const dbChainColumns = {
    c_type_name: t["string?"](),
    c_status: t["string?"](),
    c_created_at: t["string?"](),
    c_completed_at: t["string?"](),
    c_deduplication_key: t["string?"](),
    c_trace_context: t["string?"](),
  } as const;

  const jobColumnsSelect = (alias: string) =>
    Object.keys(dbJobColumns)
      .map((column) => `${alias}.${column}`)
      .join(", ");

  const chainColumnsSelect = (alias: string) =>
    `${alias}.type_name AS c_type_name, ${alias}.chain_status AS c_status, ${alias}.created_at AS c_created_at, ${alias}.chain_completed_at AS c_completed_at, ${alias}.chain_deduplication_key AS c_deduplication_key, ${alias}.chain_trace_context AS c_trace_context`;

  const chainMembers = (alias: string, chainIdExpr: string) =>
    `((${alias}.id = ${chainIdExpr} AND ${alias}.chain_index = 0) OR (${alias}.chain_id = ${chainIdExpr} AND ${alias}.chain_index > 0))`;

  const tailLateralInline = ` LEFT JOIN LATERAL (SELECT * FROM ${schema}.${tablePrefix}job WHERE chain_id = head_job.id AND chain_index > 0 ORDER BY chain_index DESC LIMIT 1) tail_job ON TRUE`;

  const tailLateral = (headAlias: string, lockClause = "") => `
LEFT JOIN LATERAL (
  SELECT *
  FROM {{schema}}.{{table_prefix}}job
  WHERE chain_id = ${headAlias}.id AND chain_index > 0
  ORDER BY chain_index DESC
  LIMIT 1${lockClause}
) AS tail_job ON TRUE`;

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
          return await fn(txCtx);
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
      const chainsSelect = (locked: boolean) =>
        `
SELECT
  row_to_json(head_job) AS head_job,
  row_to_json(tail_job) AS tail_job
FROM {{schema}}.{{table_prefix}}job AS head_job${tailLateral("head_job")}
WHERE head_job.id = ANY($1::{{id_type}}[]) AND head_job.chain_index = 0${
          locked ? "\nORDER BY head_job.id\nFOR UPDATE OF head_job" : ""
        }
`;
      const getChainsSql = templateCache.getOrCompute("getChains", () =>
        applyTemplate(
          sql(chainsSelect(false), {
            id: "getChains",
            params: [t.array()],
            columns: rowToJsonJobColumns,
            readOnly: true,
          }),
        ),
      );
      const getChainsLockedSql = templateCache.getOrCompute("getChainsLocked", () =>
        applyTemplate(
          sql(chainsSelect(true), {
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
      const byId = new Map(rows.map((r) => [r.head_job.id, r]));
      return chainIds.map((id) => {
        const row = byId.get(id);
        return row ? mapDbChainRowToStateChain(row) : undefined;
      });
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
      const lockedIds = `
WITH lock_ids AS (
  SELECT c.id FROM {{schema}}.{{table_prefix}}job c WHERE c.id = ANY($1::{{id_type}}[])
  UNION
  SELECT c.chain_id FROM {{schema}}.{{table_prefix}}job c WHERE c.id = ANY($1::{{id_type}}[])
)`;
      const jobsSelect = (locked: boolean) => `${locked ? lockedIds : ""}
SELECT j.*, ${chainColumnsSelect("h")}
FROM ${locked ? "lock_ids l JOIN {{schema}}.{{table_prefix}}job j ON j.id = l.id" : "{{schema}}.{{table_prefix}}job j"}
JOIN {{schema}}.{{table_prefix}}job h ON h.id = j.chain_id
${locked ? "ORDER BY j.id\nFOR UPDATE OF j" : "WHERE j.id = ANY($1::{{id_type}}[])"}
`;
      const getJobsSql = templateCache.getOrCompute("getJobs", () =>
        applyTemplate(
          sql(jobsSelect(false), {
            id: "getJobs",
            params: [t.array()],
            columns: { ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          }),
        ),
      );
      const getJobsLockedSql = templateCache.getOrCompute("getJobsLocked", () =>
        applyTemplate(
          sql(jobsSelect(true), {
            id: "getJobsLocked",
            params: [t.array()],
            columns: { ...dbJobColumns, ...dbChainColumns },
          }),
        ),
      );
      const rows = await executeTypedSql({
        txCtx,
        sql: lock === "exclusive" ? getJobsLockedSql : getJobsSql,
        params: [jobIds as string[]],
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return jobIds.map((id) => {
        const row = byId.get(id);
        return row ? mapDbJobRowToStateJob(row) : undefined;
      });
    }) as StateAdapter<TTxContext, TIdType>["getJobs"],

    createJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];

      for (const job of jobs) {
        if (job.id !== undefined) validateId(job.id, "caller");
      }
      const ids = jobs.map((j) => (j.id ?? generateId()) as string);

      const results = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("createJobs", () =>
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
    0                    AS chain_index,
    raw.input, raw.dedup_key, raw.dedup_scope,
    raw.scheduled_at, raw.schedule_after_ms,
    raw.chain_trace_context, raw.trace_context, raw.ord
  FROM unnest(
    $2::text[],
    $3::text[], $4::text[], $5::text[],
    $6::timestamptz[], $7::bigint[],
    $8::text[], $9::text[]
  ) WITH ORDINALITY AS raw(
    type_name,
    input, dedup_key, dedup_scope,
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
    AND j.chain_deduplication_key = id2.dedup_key
    AND j.chain_index = 0
    AND j.type_name = id2.type_name
    AND (
      (id2.dedup_scope = 'running' AND j.chain_status = 'running')
      OR (id2.dedup_scope = 'any')
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
      WHERE tia2.dedup_key = tia.dedup_key AND tia2.type_name = tia.type_name AND tia2.ord < tia.ord
    )
),
inserted_jobs AS (
  INSERT INTO {{schema}}.{{table_prefix}}job (id, type_name, chain_id, chain_index, chain_status, input, chain_deduplication_key, scheduled_at, chain_trace_context, trace_context)
  SELECT
    ti.id, ti.type_name, ti.chain_id,
    ti.chain_index, 'running', ti.input::jsonb, ti.dedup_key,
    GREATEST(COALESCE(ti.scheduled_at, now() + (ti.schedule_after_ms || ' milliseconds')::interval, now()), now()),
    ti.chain_trace_context, ti.trace_context
  FROM to_insert ti
  RETURNING *
)
SELECT ed.ord, ${jobColumnsSelect("ed")}, TRUE AS deduplicated
FROM existing_deduplicated ed
UNION ALL
SELECT tia.ord, ${jobColumnsSelect("ij")}, TRUE AS deduplicated
FROM to_insert_all tia
JOIN to_insert ti ON ti.dedup_key = tia.dedup_key AND ti.type_name = tia.type_name
JOIN inserted_jobs ij ON ti.chain_id = ij.chain_id AND ti.chain_index = ij.chain_index
WHERE tia.dedup_key IS NOT NULL AND tia.ord != ti.ord
UNION ALL
SELECT ti.ord, ${jobColumnsSelect("ij")}, FALSE AS deduplicated
FROM inserted_jobs ij JOIN to_insert ti ON ti.chain_id = ij.chain_id AND ti.chain_index = ij.chain_index
ORDER BY ord
`,
              {
                id: "createJobs",
                params: [
                  t.array(),
                  t.array(),
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
          jobs.map((j) => (j.input !== undefined ? JSON.stringify(j.input) : null)),
          jobs.map((j) => j.deduplication?.key ?? null),
          jobs.map((j) => (j.deduplication ? j.deduplication.scope : null)),
          jobs.map((j) => j.schedule?.at?.toISOString() ?? null),
          jobs.map((j) => j.schedule?.afterMs ?? null),
          jobs.map((j) => j.chainTraceContext ?? null),
          jobs.map((j) => j.traceContext ?? null),
        ],
      });

      return results.map((r) => ({
        ...mapDbHeadToStateChainInfo(r),
        head: mapDbJobToStateJobInfo(r),
        tail: undefined,
        deduplicated: r.deduplicated,
      }));
    },

    continueJobs: async ({ txCtx, completedBy, jobs }) => {
      if (jobs.length === 0) return [];
      for (const job of jobs) {
        if (job.id !== undefined) validateId(job.id, "caller");
      }
      const ids = jobs.map((job) => (job.id ?? generateId()) as string);

      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("continueJobs", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT new_id, type_name, input, sched_at, sched_after_ms, trace_context, continue_from_id
  FROM unnest(
    $1::{{id_type}}[], $2::text[], $3::text[],
    $4::timestamptz[], $5::bigint[],
    $6::text[], $7::{{id_type}}[]
  ) AS t(
    new_id, type_name, input, sched_at, sched_after_ms,
    trace_context, continue_from_id
  )
),
parent AS (
  SELECT d.*, p.chain_id, p.chain_index
  FROM input_data d
  JOIN {{schema}}.{{table_prefix}}job p
    ON p.id = d.continue_from_id AND p.status <> 'completed'
),
inserted AS (
  INSERT INTO {{schema}}.{{table_prefix}}job (id, type_name, chain_id, chain_index, input, scheduled_at, trace_context)
  SELECT
    pr.new_id, pr.type_name, pr.chain_id, pr.chain_index + 1, pr.input::jsonb,
    GREATEST(COALESCE(pr.sched_at, now() + (pr.sched_after_ms || ' milliseconds')::interval, now()), now()),
    pr.trace_context
  FROM parent pr
  RETURNING *
),
completed AS (
  UPDATE {{schema}}.{{table_prefix}}job j
  SET status = 'completed',
    completed_at = now(),
    completed_by = $8,
    continued_to_id = pr.new_id,
    output = NULL,
    last_attempt_error = NULL,
    attempt_at = NULL,
    attempt_by = NULL,
    attempt_until = NULL
  FROM parent pr
  WHERE j.id = pr.continue_from_id
    AND j.status <> 'completed'
  RETURNING j.*, pr.new_id
)
SELECT
  c.new_id             AS continuation_id,
  row_to_json(c)       AS job_row,
  row_to_json(h)       AS head_job,
  row_to_json(i)       AS continuation_row
FROM completed c
JOIN {{schema}}.{{table_prefix}}job h ON h.id = c.chain_id
JOIN inserted i ON i.id = c.new_id
`,
              {
                id: "continueJobs",
                params: [
                  t.array(),
                  t.array(),
                  t.array<string | null>(),
                  t.array<string | null>(),
                  t.array<number | null>(),
                  t.array<string | null>(),
                  t.array(),
                  t["string?"](),
                ],
                columns: {
                  continuation_id: idDataType,
                  job_row: t.json<DbJob>(),
                  head_job: t.json<DbJob>(),
                  continuation_row: t.json<DbJob>(),
                },
              },
            ),
          ),
        ),
        params: [
          ids,
          jobs.map((job) => job.typeName),
          jobs.map((job) => (job.input !== undefined ? JSON.stringify(job.input) : null)),
          jobs.map((job) => job.schedule?.at?.toISOString() ?? null),
          jobs.map((job) => job.schedule?.afterMs ?? null),
          jobs.map((job) => job.traceContext ?? null),
          jobs.map((job) => job.continueFromId),
          completedBy ?? null,
        ],
      });

      const rowByContinuationId = new Map(rows.map((row) => [row.continuation_id, row]));

      return jobs.map((_job, i) => {
        const row = rowByContinuationId.get(ids[i]);
        if (!row) return undefined;
        return {
          ...mapDbJobToStateJobInfo(row.job_row),
          chain: mapDbHeadToStateChainInfo(row.head_job),
          continuation: mapDbJobToStateJobInfo(row.continuation_row),
        };
      });
    },

    completeJobs: async ({ txCtx, completedBy, jobs }) => {
      if (jobs.length === 0) return [];

      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("completeJobs", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT job_id, output
  FROM unnest($1::{{id_type}}[], $2::text[]) AS t(job_id, output)
),
targets AS (
  SELECT d.job_id, d.output, j.chain_id
  FROM input_data d
  JOIN {{schema}}.{{table_prefix}}job j ON j.id = d.job_id AND j.status <> 'completed'
),
row_effects AS (
  SELECT
    ids.id,
    (SELECT tg.output FROM targets tg WHERE tg.job_id = ids.id) AS output,
    EXISTS (SELECT 1 FROM targets tg WHERE tg.job_id = ids.id) AS completes_job,
    EXISTS (SELECT 1 FROM targets tg WHERE tg.chain_id = ids.id) AS completes_chain,
    EXISTS (
      SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker jb
      WHERE jb.blocked_by_chain_id = ids.id
    ) AS has_blocking
  FROM (
    SELECT job_id AS id FROM targets
    UNION
    SELECT chain_id AS id FROM targets
  ) ids
)
UPDATE {{schema}}.{{table_prefix}}job j
SET status = CASE WHEN e.completes_job THEN 'completed' ELSE j.status END,
  last_attempt_error = CASE WHEN e.completes_job THEN NULL ELSE j.last_attempt_error END,
  attempt_at = CASE WHEN e.completes_job THEN NULL ELSE j.attempt_at END,
  attempt_by = CASE WHEN e.completes_job THEN NULL ELSE j.attempt_by END,
  attempt_until = CASE WHEN e.completes_job THEN NULL ELSE j.attempt_until END,
  completed_at = CASE WHEN e.completes_job THEN now() ELSE j.completed_at END,
  completed_by = CASE WHEN e.completes_job THEN $3 ELSE j.completed_by END,
  output = CASE WHEN e.completes_job THEN e.output::jsonb ELSE j.output END,
  chain_status = CASE WHEN e.completes_chain THEN 'completed' ELSE j.chain_status END,
  chain_completed_at = CASE WHEN e.completes_chain AND j.chain_completed_at IS NULL
                            THEN now() ELSE j.chain_completed_at END
FROM row_effects e
WHERE j.id = e.id
RETURNING j.*, e.has_blocking
`,
              {
                id: "completeJobs",
                params: [t.array(), t.array<string | null>(), t["string?"]()],
                columns: { ...dbJobColumns, has_blocking: t.boolean() },
              },
            ),
          ),
        ),
        params: [
          jobs.map((job) => job.jobId as string),
          jobs.map((job) => (job.output !== undefined ? JSON.stringify(job.output) : null)),
          completedBy ?? null,
        ],
      });

      const rowById = new Map(rows.map((row) => [row.id, row]));

      return jobs.map((job) => {
        const row = rowById.get(job.jobId);
        if (!row) return undefined;
        const head = rowById.get(row.chain_id)!;
        return {
          ...mapDbJobToStateJobInfo(row),
          chain: mapDbHeadToStateChainInfo(head),
          hasBlockedJobs: head.has_blocking,
        };
      });
    },

    rescheduleJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("rescheduleJobs", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT job_id, at, after_ms, error
  FROM unnest($1::{{id_type}}[], $2::timestamptz[], $3::bigint[], $4::text[]) AS t(job_id, at, after_ms, error)
),
updated AS (
  UPDATE {{schema}}.{{table_prefix}}job j
  SET status = CASE WHEN j.status = 'running' THEN 'pending' ELSE j.status END,
    scheduled_at = GREATEST(COALESCE(d.at, now() + (d.after_ms || ' milliseconds')::interval, now()), now()),
    last_attempt_at = CASE WHEN j.status = 'running' THEN now() ELSE j.last_attempt_at END,
    last_attempt_error = CASE WHEN j.status = 'running' THEN d.error::jsonb ELSE j.last_attempt_error END,
    attempt_at = NULL,
    attempt_by = NULL,
    attempt_until = NULL
  FROM input_data d
  WHERE j.id = d.job_id
    AND j.status <> 'completed'
  RETURNING j.*
)
SELECT u.*, ${chainColumnsSelect("h")}
FROM updated u
JOIN {{schema}}.{{table_prefix}}job h ON h.id = u.chain_id
`,
              {
                id: "rescheduleJobs",
                params: [
                  t.array(),
                  t.array<string | null>(),
                  t.array<string | null>(),
                  t.array<string | null>(),
                ],
                columns: { ...dbJobColumns, ...dbChainColumns },
              },
            ),
          ),
        ),
        params: [
          jobs.map((job) => job.jobId as string),
          jobs.map((job) => job.schedule?.at?.toISOString() ?? null),
          jobs.map((job) => (job.schedule?.afterMs != null ? String(job.schedule.afterMs) : null)),
          jobs.map((job) => (job.error !== undefined ? JSON.stringify(job.error) : null)),
        ],
      });
      const rowById = new Map(rows.map((row) => [row.id, row]));
      return jobs.map((job) => {
        const row = rowById.get(job.jobId as string);
        return row ? mapDbJobRowToStateJob(row) : undefined;
      });
    },

    deleteChains: async ({ txCtx, chainIds }) => {
      if (chainIds.length === 0) return [];
      const [row] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("deleteChains", () =>
          applyTemplate(
            sql(
              `
WITH _locked AS (
  SELECT id FROM {{schema}}.{{table_prefix}}job
  WHERE (id = ANY($1::{{id_type}}[]) AND chain_index = 0)
     OR (chain_id = ANY($1::{{id_type}}[]) AND chain_index > 0)
  ORDER BY ctid
  FOR UPDATE
),
_external_refs AS (
  SELECT jb.job_id, jb.blocked_by_chain_id, jb."index" AS blocker_index, jb.trace_context AS blocker_trace_context
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
    WHERE chain_id = root.id AND chain_index > 0
    ORDER BY chain_index DESC
    LIMIT 1
  ) AS lc ON TRUE
)
SELECT
  COALESCE((SELECT json_agg(row_to_json(p)) FROM _deleted_pairs p), '[]'::json) AS deleted,
  COALESCE((SELECT json_agg(json_build_object(
    'job_id', r.job_id,
    'blocked_by_chain_id', r.blocked_by_chain_id,
    'index', r.blocker_index,
    'trace_context', r.blocker_trace_context,
    'job', row_to_json(j)
  )) FROM _external_refs r JOIN {{schema}}.{{table_prefix}}job j ON j.id = r.job_id), '[]'::json) AS blocker_refs
`,
              {
                id: "deleteChains",
                params: [t.array()],
                columns: {
                  deleted: t.json<{ head_job: DbJob; tail_job: DbJob | null }[]>(),
                  blocker_refs: t.json<
                    {
                      job_id: string;
                      blocked_by_chain_id: string;
                      index: number;
                      trace_context: string | null;
                      job: DbJob;
                    }[]
                  >(),
                },
              },
            ),
          ),
        ),
        params: [chainIds],
      });
      const deletedById = new Map(row.deleted.map((d) => [d.head_job.id, d]));
      const refsByChainId = new Map<string, typeof row.blocker_refs>();
      for (const ref of row.blocker_refs) {
        let arr = refsByChainId.get(ref.blocked_by_chain_id);
        if (!arr) {
          arr = [];
          refsByChainId.set(ref.blocked_by_chain_id, arr);
        }
        arr.push(ref);
      }

      return chainIds.map((chainId): StateChain | StateBlockedJob[] | undefined => {
        const refs = refsByChainId.get(chainId);
        if (refs) {
          return refs.map(
            (r): StateBlockedJob => ({
              jobId: r.job_id,
              blockedByChainId: r.blocked_by_chain_id,
              index: r.index,
              traceContext: r.trace_context,
              job: mapDbJobToStateJobInfo(r.job),
            }),
          );
        }
        const deleted = deletedById.get(chainId);
        if (deleted) {
          return mapDbChainRowToStateChain(deleted);
        }
        return undefined;
      });
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
      AND status = 'pending'
      AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ) j
  LIMIT 1
),
locked_chain AS (
  SELECT h.id
  FROM {{schema}}.{{table_prefix}}job h
  WHERE h.id = (SELECT chain_id FROM {{schema}}.{{table_prefix}}job WHERE id = (SELECT id FROM acquired_job))
  FOR UPDATE SKIP LOCKED
),
updated AS (
  UPDATE {{schema}}.{{table_prefix}}job
  SET status = 'running',
    attempt = attempt + 1,
    attempt_at = now(),
    attempt_by = $2
  WHERE id = (SELECT id FROM acquired_job)
    AND EXISTS (SELECT 1 FROM locked_chain)
  RETURNING *
)
SELECT
  u.*,
  ${chainColumnsSelect("h")},
  EXISTS (
    SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker jb WHERE jb.job_id = u.id
  ) AS has_blockers
FROM updated u
JOIN {{schema}}.{{table_prefix}}job h ON h.id = u.chain_id
`,
              {
                id: "startJobAttempt",
                params: [t.array(), t.string()],
                columns: { ...dbJobColumns, ...dbChainColumns, has_blockers: t.boolean() },
              },
            ),
          ),
        ),
        params: [typeNames, workerId],
      });

      if (!result) return undefined;
      return { ...mapDbJobRowToStateJob(result), hasBlockers: result.has_blockers };
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
      AND status = 'pending'
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
      AND status = 'pending'
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

    extendJobAttempt: async ({ txCtx, jobId, workerId, timeoutMs }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("extendJobAttempt", () =>
          applyTemplate(
            sql(
              `
WITH updated AS (
  UPDATE {{schema}}.{{table_prefix}}job
  SET attempt_until = now() + ($3::bigint || ' milliseconds')::interval
  WHERE id = $1
    AND attempt_by = $2
  RETURNING *
)
SELECT u.*, ${chainColumnsSelect("h")}
FROM updated u
JOIN {{schema}}.{{table_prefix}}job h ON h.id = u.chain_id
`,
              {
                id: "extendJobAttempt",
                params: [idDataType, t.string(), t.number()],
                columns: { ...dbJobColumns, ...dbChainColumns },
              },
            ),
          ),
        ),
        params: [jobId, workerId, timeoutMs],
      });

      return job ? mapDbJobRowToStateJob(job) : undefined;
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
      AND status = 'running'
      AND attempt_until IS NOT NULL
      AND attempt_until <= now()
      AND id != ALL($2::{{id_type}}[])
    ORDER BY attempt_until ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ) j
  LIMIT 1
),
updated AS (
  UPDATE {{schema}}.{{table_prefix}}job as job
  SET status = 'pending',
    attempt_at = NULL,
    attempt_by = NULL,
    attempt_until = NULL
  FROM job_to_unlock
  WHERE job.id = job_to_unlock.id
  RETURNING job.*
)
SELECT u.*, ${chainColumnsSelect("h")}
FROM updated u
JOIN {{schema}}.{{table_prefix}}job h ON h.id = u.chain_id
`,
              {
                id: "reclaimExpiredJobAttempt",
                params: [t.array(), t.array()],
                columns: { ...dbJobColumns, ...dbChainColumns },
              },
            ),
          ),
        ),
        params: [typeNames, ignoredJobIds ?? []],
      });
      return job ? mapDbJobRowToStateJob(job) : undefined;
    },

    addJobsBlockers: async ({ txCtx, jobBlockers }) => {
      if (jobBlockers.length === 0) return [];

      const flatJobIds: string[] = [];
      const flatBlockedByChainIds: string[] = [];
      const flatTraceContexts: (string | null)[] = [];
      const flatIndexes: number[] = [];

      for (const { jobId, blockedByChainIds, blockerTraceContexts } of jobBlockers) {
        blockedByChainIds.forEach((blockedByChainId, index) => {
          flatJobIds.push(jobId);
          flatBlockedByChainIds.push(blockedByChainId);
          flatTraceContexts.push(blockerTraceContexts?.[index] ?? null);
          flatIndexes.push(index);
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
locked_blocker_heads AS (
  SELECT h.*
  FROM {{schema}}.{{table_prefix}}job h
  WHERE h.id IN (SELECT DISTINCT blocked_by_chain_id FROM input_data)
    AND h.chain_index = 0
  ORDER BY h.id
  FOR UPDATE
),
inserted_blockers AS (
  INSERT INTO {{schema}}.{{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
  SELECT job_id, blocked_by_chain_id, "index", trace_context
  FROM input_data
  RETURNING job_id, blocked_by_chain_id
),
has_incomplete_blockers AS (
  SELECT DISTINCT d.job_id
  FROM input_data d
  LEFT JOIN locked_blocker_heads h ON h.id = d.blocked_by_chain_id
  WHERE h.chain_status IS DISTINCT FROM 'completed'
),
updated_jobs AS (
  UPDATE {{schema}}.{{table_prefix}}job j
  SET status = 'blocked'
  WHERE j.id IN (SELECT job_id FROM has_incomplete_blockers)
    AND j.status = 'pending'
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
)
SELECT
  d.blocked_by_chain_id,
  row_to_json(fj) AS job_row,
  row_to_json(h) AS head_job,
  row_to_json(jh) AS job_chain_head
FROM input_data d
JOIN final_jobs fj ON fj.id = d.job_id
JOIN {{schema}}.{{table_prefix}}job jh ON jh.id = fj.chain_id
LEFT JOIN locked_blocker_heads h ON h.id = d.blocked_by_chain_id
`,
              {
                id: "addJobsBlockers",
                params: [t.array(), t.array(), t.array<string | null>(), t.array<number>()],
                columns: {
                  blocked_by_chain_id: idDataType,
                  job_row: t.json<DbJob>(),
                  head_job: t["json?"]<DbJob>(),
                  job_chain_head: t.json<DbJob>(),
                },
              },
            ),
          ),
        ),
        params: [flatJobIds, flatBlockedByChainIds, flatTraceContexts, flatIndexes],
      });

      const jobInfoById = new Map<string, StateJobInfo>();
      const jobChainInfoById = new Map<string, StateChainInfo>();
      const blockerChainInfoById = new Map<string, StateChainInfo>();
      for (const row of results) {
        jobInfoById.set(row.job_row.id, mapDbJobToStateJobInfo(row.job_row));
        jobChainInfoById.set(row.job_row.id, mapDbHeadToStateChainInfo(row.job_chain_head));
        if (!row.head_job) continue;
        blockerChainInfoById.set(row.blocked_by_chain_id, mapDbHeadToStateChainInfo(row.head_job));
      }

      return jobBlockers.map((entry) => ({
        ...jobInfoById.get(entry.jobId)!,
        chain: jobChainInfoById.get(entry.jobId)!,
        blockers: entry.blockedByChainIds.map((chainId) => blockerChainInfoById.get(chainId)),
      }));
    },

    getJobBlockers: async ({ txCtx, jobId }) => {
      const chains = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getJobBlockers", () =>
          applyTemplate(
            sql(
              `
SELECT
  row_to_json(head_job) AS head_job,
  row_to_json(tail_job) AS tail_job
FROM {{schema}}.{{table_prefix}}job_blocker AS b
JOIN {{schema}}.{{table_prefix}}job AS head_job
  ON head_job.id = b.blocked_by_chain_id${tailLateral("head_job")}
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

      return chains.map(mapDbChainRowToStateChain);
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
AND j.status = 'blocked'
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
    (h.chain_status = 'completed') AS blocker_complete
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  LEFT JOIN {{schema}}.{{table_prefix}}job h ON h.id = jb.blocked_by_chain_id
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
  SET status = 'pending',
    scheduled_at = GREATEST(j.scheduled_at, now())
  WHERE j.id IN (SELECT job_id FROM ready_jobs)
    AND j.status = 'blocked'
  RETURNING j.*
),
blocker_rows AS (
  SELECT jb.job_id, jb.blocked_by_chain_id, jb."index", jb.trace_context
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.blocked_by_chain_id = $1
  ORDER BY jb.job_id, jb."index"
)
SELECT COALESCE((
  SELECT json_agg(json_build_object(
    'job_id', b.job_id,
    'blocked_by_chain_id', b.blocked_by_chain_id,
    'index', b."index",
    'trace_context', b.trace_context,
    'job', COALESCE(
      (SELECT row_to_json(u) FROM updated u WHERE u.id = b.job_id),
      (SELECT row_to_json(j) FROM {{schema}}.{{table_prefix}}job j WHERE j.id = b.job_id)
    )
  ) ORDER BY b.job_id, b."index")
  FROM blocker_rows b
), '[]'::json) AS blockers;
`,
              {
                id: "unblockJobs",
                params: [idDataType],
                columns: {
                  blockers: t.json<
                    {
                      job_id: string;
                      blocked_by_chain_id: string;
                      index: number;
                      trace_context: string | null;
                      job: DbJob;
                    }[]
                  >(),
                },
              },
            ),
          ),
        ),
        params: [blockedByChainId],
      });
      return result.blockers.map(
        (b): StateBlockedJob => ({
          jobId: b.job_id,
          blockedByChainId: b.blocked_by_chain_id,
          index: b.index,
          traceContext: b.trace_context,
          job: mapDbJobToStateJobInfo(b.job),
        }),
      );
    },

    listChainTypeNames: async ({ txCtx }) => {
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("listChainTypeNames", () =>
          applyTemplate(
            sql(
              /* sql */ `
WITH RECURSIVE types AS (
  (SELECT type_name FROM {{schema}}.{{table_prefix}}job WHERE chain_index = 0 ORDER BY type_name LIMIT 1)
  UNION ALL
  SELECT (SELECT type_name FROM {{schema}}.{{table_prefix}}job WHERE chain_index = 0 AND type_name > types.type_name ORDER BY type_name LIMIT 1)
  FROM types WHERE types.type_name IS NOT NULL
)
SELECT type_name FROM types WHERE type_name IS NOT NULL
`,
              {
                id: "listChainTypeNames",
                params: [],
                columns: { type_name: t.string() },
                readOnly: true,
              },
            ),
          ),
        ),
      });
      return rows.map((r) => r.type_name);
    },

    listJobTypeNames: async ({ txCtx }) => {
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("listJobTypeNames", () =>
          applyTemplate(
            sql(
              /* sql */ `
WITH RECURSIVE types AS (
  (SELECT type_name FROM {{schema}}.{{table_prefix}}job ORDER BY type_name LIMIT 1)
  UNION ALL
  SELECT (SELECT type_name FROM {{schema}}.{{table_prefix}}job WHERE type_name > types.type_name ORDER BY type_name LIMIT 1)
  FROM types WHERE types.type_name IS NOT NULL
)
SELECT type_name FROM types WHERE type_name IS NOT NULL
`,
              {
                id: "listJobTypeNames",
                params: [],
                columns: { type_name: t.string() },
                readOnly: true,
              },
            ),
          ),
        ),
      });
      return rows.map((r) => r.type_name);
    },

    countByChainTypeNames: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return [];

      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("countByChainTypeNames", () =>
          applyTemplate(
            sql(
              /* sql */ `
SELECT
  t.name,
  (SELECT count(*) FROM (
    SELECT 1 FROM {{schema}}.{{table_prefix}}job
    WHERE type_name = t.name AND chain_index = 0 AND chain_status = 'running'
    LIMIT ${COUNT_CAP + 1}
  ) sub) AS running_cnt,
  (SELECT count(*) FROM (
    SELECT 1 FROM {{schema}}.{{table_prefix}}job
    WHERE type_name = t.name AND chain_index = 0 AND chain_status = 'completed'
    LIMIT ${COUNT_CAP + 1}
  ) sub) AS completed_cnt
FROM unnest($1::text[]) WITH ORDINALITY AS t(name, ord)
ORDER BY t.ord
`,
              {
                id: "countByChainTypeNames",
                params: [t.array()],
                columns: {
                  name: t.string(),
                  running_cnt: t.number(),
                  completed_cnt: t.number(),
                },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [[...typeNames]],
      });

      const map = new Map(rows.map((r) => [r.name, r]));
      return typeNames.map((name) => {
        const r = map.get(name);
        if (!r)
          return {
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          };
        return {
          running: {
            count: Math.min(r.running_cnt, COUNT_CAP),
            hasMore: r.running_cnt > COUNT_CAP,
          },
          completed: {
            count: Math.min(r.completed_cnt, COUNT_CAP),
            hasMore: r.completed_cnt > COUNT_CAP,
          },
        };
      });
    },

    countByJobTypeNames: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return [];

      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("countByJobTypeNames", () =>
          applyTemplate(
            sql(
              /* sql */ `
SELECT
  t.name,
  (SELECT count(*) FROM (SELECT 1 FROM {{schema}}.{{table_prefix}}job WHERE type_name = t.name AND status = 'blocked' LIMIT ${COUNT_CAP + 1}) sub) AS blocked_cnt,
  (SELECT count(*) FROM (SELECT 1 FROM {{schema}}.{{table_prefix}}job WHERE type_name = t.name AND status = 'pending' LIMIT ${COUNT_CAP + 1}) sub) AS pending_cnt,
  (SELECT count(*) FROM (SELECT 1 FROM {{schema}}.{{table_prefix}}job WHERE type_name = t.name AND status = 'running' LIMIT ${COUNT_CAP + 1}) sub) AS running_cnt,
  (SELECT count(*) FROM (SELECT 1 FROM {{schema}}.{{table_prefix}}job WHERE type_name = t.name AND status = 'completed' LIMIT ${COUNT_CAP + 1}) sub) AS completed_cnt
FROM unnest($1::text[]) WITH ORDINALITY AS t(name, ord)
ORDER BY t.ord
`,
              {
                id: "countByJobTypeNames",
                params: [t.array()],
                columns: {
                  name: t.string(),
                  blocked_cnt: t.number(),
                  pending_cnt: t.number(),
                  running_cnt: t.number(),
                  completed_cnt: t.number(),
                },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [[...typeNames]],
      });

      const map = new Map(rows.map((r) => [r.name, r]));
      return typeNames.map((name) => {
        const r = map.get(name);
        if (!r)
          return {
            blocked: { count: 0, hasMore: false },
            pending: { count: 0, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          };
        return {
          blocked: {
            count: Math.min(r.blocked_cnt, COUNT_CAP),
            hasMore: r.blocked_cnt > COUNT_CAP,
          },
          pending: {
            count: Math.min(r.pending_cnt, COUNT_CAP),
            hasMore: r.pending_cnt > COUNT_CAP,
          },
          running: {
            count: Math.min(r.running_cnt, COUNT_CAP),
            hasMore: r.running_cnt > COUNT_CAP,
          },
          completed: {
            count: Math.min(r.completed_cnt, COUNT_CAP),
            hasMore: r.completed_cnt > COUNT_CAP,
          },
        };
      });
    },

    listChains: async ({
      txCtx,
      typeName,
      independent,
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

      const orderColumn = orderBy === "completedAt" ? "chain_completed_at" : "created_at";

      conditions.push("head_job.chain_index = 0");
      conditions.push(`head_job.type_name = $${p}::text`);
      params.push(typeName);
      paramTypes.push(t.string());
      p++;

      if (status !== undefined) {
        conditions.push(chainStatusConditions[status]);
      }

      if (independent === true) {
        conditions.push(
          `NOT EXISTS (SELECT 1 FROM ${schema}.${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = head_job.id)`,
        );
      } else if (independent === false) {
        conditions.push(
          `EXISTS (SELECT 1 FROM ${schema}.${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = head_job.id)`,
        );
      }

      if (from) {
        conditions.push(`head_job.${orderColumn} >= $${p}::timestamptz`);
        params.push(from);
        paramTypes.push(t["date?"]());
        p++;
      }
      if (to) {
        conditions.push(`head_job.${orderColumn} <= $${p}::timestamptz`);
        params.push(to);
        paramTypes.push(t["date?"]());
        p++;
      }

      if (cursor) {
        conditions.push(
          `(head_job.${orderColumn} ${cmp} $${p}::timestamptz OR (head_job.${orderColumn} = $${p}::timestamptz AND head_job.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.value, cursor.id);
        paramTypes.push(t["date?"](), idDataType);
        p += 2;
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const order = `ORDER BY head_job.${orderColumn} ${dir}, head_job.id ${dir}`;
      const sqlStr =
        independent === true
          ? `SELECT row_to_json(head_job) AS head_job, row_to_json(tail_job) AS tail_job FROM ${schema}.${tablePrefix}job head_job${tailLateralInline} WHERE ${conditions.join(" AND ")} ${order} LIMIT $${p}`
          : `SELECT row_to_json(head_job) AS head_job, row_to_json(tail_job) AS tail_job FROM (SELECT * FROM ${schema}.${tablePrefix}job head_job WHERE ${conditions.join(" AND ")} ${order} LIMIT $${p}) head_job${tailLateralInline} ${order}`;

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

      const items = pageRows.map(mapDbChainRowToStateChain);

      const lastItem = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastItem) {
        if (orderBy === "completedAt") {
          nextCursor = encodeCursor({
            type: "timestampWithId",
            sortKey: "completedAt",
            value: lastItem.head_job.chain_completed_at!,
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

    listJobs: async ({ txCtx, typeName, from, to, status, orderBy, orderDirection, page }) => {
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

      if (status !== undefined) {
        conditions.push(jobStatusConditions[status]);
      }

      conditions.push(`j.type_name = $${p}::text`);
      params.push(typeName);
      paramTypes.push(t.string());
      p++;
      if (from) {
        conditions.push(`j.${sqlColumn} >= $${p}::timestamptz`);
        params.push(from);
        paramTypes.push(t["date?"]());
        p++;
      }
      if (to) {
        conditions.push(`j.${sqlColumn} <= $${p}::timestamptz`);
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
      const order = `ORDER BY j.${sqlColumn} ${dir}, j.id ${dir}`;
      const sqlStr = `SELECT j.*, ${chainColumnsSelect("h")} FROM (SELECT * FROM ${schema}.${tablePrefix}job j ${where} ${order} LIMIT $${p}) j JOIN ${schema}.${tablePrefix}job h ON h.id = j.chain_id ${order}`;

      const rows = await executeTypedSql({
        txCtx,
        sql: applyTemplate(
          sql(sqlStr, {
            params: paramTypes,
            columns: { ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          }),
        ),
        params,
      });

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobRowToStateJob);

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
        SELECT j.*, ${chainColumnsSelect("h")}
        FROM ${schema}.${tablePrefix}job j, start_row s, ${schema}.${tablePrefix}job h
        WHERE ${chainMembers("j", `$1::${idType}`)}
          AND h.id = $1::${idType}
          AND j.chain_index ${cmp} s.sc
        ORDER BY j.chain_index ${dir}, j.id ${dir}
        LIMIT $3::integer`;
      } else {
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        sqlStr = `SELECT j.*, ${chainColumnsSelect("h")}
        FROM ${schema}.${tablePrefix}job j, ${schema}.${tablePrefix}job h
        WHERE ${chainMembers("j", `$1::${idType}`)}
          AND h.id = $1::${idType}
        ORDER BY j.chain_index ${dir}, j.id ${dir}
        LIMIT $2::integer`;
      }

      const rows = await executeTypedSql({
        txCtx,
        sql: applyTemplate(
          sql(sqlStr, {
            params: paramTypes,
            columns: { ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          }),
        ),
        params,
      });

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const chainInfo = pageRows[0] ? mapDbChainColumns(chainId, pageRows[0]) : undefined;
      const items = chainInfo
        ? pageRows.map((job) => ({ ...mapDbJobToStateJobInfo(job), chain: chainInfo }))
        : [];

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
      const order = `ORDER BY j.created_at ${dir}, j.id ${dir}`;
      const sqlStr = `SELECT j.*, ${chainColumnsSelect("h")} FROM (SELECT * FROM ${schema}.${tablePrefix}job j WHERE ${conditions.join(" AND ")} ${order} LIMIT $${p}) j JOIN ${schema}.${tablePrefix}job h ON h.id = j.chain_id ${order}`;

      const rows = await executeTypedSql({
        txCtx,
        sql: applyTemplate(
          sql(sqlStr, {
            params: paramTypes,
            columns: { ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          }),
        ),
        params,
      });

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobRowToStateJob);

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
      const legacy = createLegacyUpgrade(stateProvider, applyTemplate, idDataType);
      return createMigrator<TTxContext>({
        migrations,
        store: createMigrationStore(stateProvider, applyTemplate),
        before: legacy.renameLegacySchemaAside,
        after: legacy.importLegacySchema,
      }).migrateToLatest();
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
 * migrations and `truncate` for clearing all job data.
 */
export type PgStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
> = StateAdapter<TTxContext, TJobId> & {
  migrateToLatest: () => Promise<MigrationResult>;
  truncate: () => Promise<void>;
};
