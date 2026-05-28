import { type UUID, randomUUID } from "node:crypto";

import {
  type DataType,
  type InferColumns,
  type InferParams,
  type Migration,
  type MigrationResult,
  type TypedSql,
  createTemplateApplier,
  createTemplateCache,
  executeMigrations,
  extractColumnTypes,
  extractParamTypes,
  sql,
  t,
} from "@queuert/typed-sql";
import { type BaseTxContext, type StateAdapter } from "queuert";
import {
  type StateJob,
  createIdValidator,
  decodeChainIndexCursor,
  decodeCreatedAtCursor,
  encodeCursor,
} from "queuert/internal";

import { type PgStateProvider } from "../state-provider/state-provider.pg.js";

type DbJob = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_type_name: string;
  chain_index: number;

  input: unknown;
  output: unknown;

  status: "blocked" | "pending" | "running" | "completed";
  created_at: string;
  scheduled_at: string;
  completed_at: string | null;
  completed_by: string | null;

  attempt: number;
  last_attempt_error: string | null;
  last_attempt_at: string | null;

  leased_by: string | null;
  leased_until: string | null;

  deduplication_key: string | null;

  chain_trace_context: string | null;
  trace_context: string | null;
};

const migrations: Migration[] = [
  {
    name: "20240101000000_initial_schema",
    transactional: true,
    statements: [
      {
        sql: sql(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{{table_prefix}}job_status' AND typnamespace = '{{schema}}'::regnamespace) THEN
    CREATE TYPE {{schema}}.{{table_prefix}}job_status AS ENUM ('blocked','pending','running','completed');
  END IF;
END$$`),
      },
      {
        sql: sql(`
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
      },
      {
        sql: sql(`
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_blocker (
  job_id                        {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  index                         integer NOT NULL,
  trace_context                 text,
  PRIMARY KEY (job_id, blocked_by_chain_id)
)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_acquisition_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      },
      {
        sql: sql(`
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}job_chain_index_idx
ON {{schema}}.{{table_prefix}}job (chain_id, chain_index)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{schema}}.{{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_expired_lease_idx
ON {{schema}}.{{table_prefix}}job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{schema}}.{{table_prefix}}job_blocker (blocked_by_chain_id)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_idx
ON {{schema}}.{{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_idx
ON {{schema}}.{{table_prefix}}job (created_at DESC)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_status_idx
ON {{schema}}.{{table_prefix}}job (status, created_at DESC)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_type_name_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at DESC)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_type_name_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`),
      },
    ],
  },
  {
    name: "20240102000000_vacuum_tuning",
    transactional: true,
    statements: [
      {
        sql: sql(`
ALTER TABLE {{schema}}.{{table_prefix}}job SET (
  fillfactor = 75,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 0
)`),
      },
      {
        sql: sql(`
ALTER TABLE {{schema}}.{{table_prefix}}job_blocker SET (
  autovacuum_vacuum_cost_delay = 0
)`),
      },
    ],
  },
  {
    name: "20260430000000_rename_chain_indexes",
    transactional: true,
    statements: [
      {
        sql: sql(`
ALTER INDEX IF EXISTS {{schema}}.{{table_prefix}}job_chain_index_idx
RENAME TO {{table_prefix}}chain_index_idx`),
      },
      {
        sql: sql(`
ALTER INDEX IF EXISTS {{schema}}.{{table_prefix}}job_chain_listing_idx
RENAME TO {{table_prefix}}chain_listing_idx`),
      },
      {
        sql: sql(`
ALTER INDEX IF EXISTS {{schema}}.{{table_prefix}}job_chain_listing_type_name_idx
RENAME TO {{table_prefix}}chain_listing_type_name_idx`),
      },
    ],
  },
  {
    name: "20260517000000_drop_job_id_default",
    transactional: true,
    statements: [
      {
        sql: sql(`
ALTER TABLE {{schema}}.{{table_prefix}}job ALTER COLUMN id DROP DEFAULT`),
      },
    ],
  },
];

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const validateSqlIdentifier = (value: string, name: string): void => {
  if (!SQL_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: "${value}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ to prevent SQL injection.`,
    );
  }
};

type DbChainRow = { root_job: DbJob; last_chain_job: DbJob | null };

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
  const byId = new Map(rows.map((r) => [r.root_job.id, r]));
  return chainIds.map((id): [StateJob, StateJob | undefined] | undefined => {
    const row = byId.get(id);
    if (!row) return undefined;
    return [
      mapDbJobToStateJob(row.root_job),
      row.last_chain_job && row.last_chain_job.id !== row.root_job.id
        ? mapDbJobToStateJob(row.last_chain_job)
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
    chainIndex: dbJob.chain_index,
    input: dbJob.input,
    output: dbJob.output,

    status: dbJob.status,
    createdAt: new Date(dbJob.created_at),
    scheduledAt: new Date(dbJob.scheduled_at),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at) : null,
    completedBy: dbJob.completed_by,

    attempt: dbJob.attempt,
    lastAttemptError: dbJob.last_attempt_error,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at) : null,

    leasedBy: dbJob.leased_by,
    leasedUntil: dbJob.leased_until ? new Date(dbJob.leased_until) : null,

    deduplicationKey: dbJob.deduplication_key,

    chainTraceContext: dbJob.chain_trace_context,
    traceContext: dbJob.trace_context,
  };
};

/** Create a state adapter backed by PostgreSQL. Returns the adapter with a `migrateToLatest()` method for schema migrations. */
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
  /** Function to generate new job IDs. IDs are generated in JS and bound as a query parameter; the column has no SQL `DEFAULT`. @defaultValue `() => crypto.randomUUID()` */
  generateId?: () => TIdType;
  /** Predicate returning `true` if the ID is acceptable. Runs on both generated and caller-supplied IDs; failures throw `InvalidJobIdError`. */
  validateId?: (id: TIdType) => boolean;
  /** Phantom property for generic type inference of the ID type. Not used at runtime. */
  $idType?: TIdType;
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
  const dbJobColumns = {
    id: idDataType,
    chain_id: idDataType,
    type_name: t.string(),
    chain_type_name: t.string(),
    chain_index: t.number(),
    input: t.json(),
    output: t.json(),
    status: t.string<DbJob["status"]>(),
    created_at: t.string(),
    scheduled_at: t.string(),
    completed_at: t["string?"](),
    completed_by: t["string?"](),
    attempt: t.number(),
    last_attempt_error: t["json?"]<string>(),
    last_attempt_at: t["string?"](),
    leased_by: t["string?"](),
    leased_until: t["string?"](),
    deduplication_key: t["string?"](),
    chain_trace_context: t["string?"](),
    trace_context: t["string?"](),
  } as const;

  const rowToJsonJobColumns = {
    root_job: t.json<DbJob>(),
    last_chain_job: t["json?"]<DbJob>(),
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
          sql: applyTemplate(sql(`SAVEPOINT ${sp}`, { readOnly: true, params: [], columns: {} })),
        });
        try {
          const result = await fn(txCtx);
          await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(`RELEASE SAVEPOINT ${sp}`, { readOnly: true, params: [], columns: {} }),
            ),
          });
          return result;
        } catch (error) {
          await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(`ROLLBACK TO SAVEPOINT ${sp}`, { readOnly: true, params: [], columns: {} }),
            ),
          }).catch(() => {});
          throw error;
        }
      }),

    getChains: (async ({
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
  row_to_json(j)  AS root_job,
  row_to_json(lc) AS last_chain_job
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
    }) as StateAdapter<TTxContext, TIdType>["getChains"],
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
    gi.id, type_name, chain_id, chain_type_name, chain_index,
    input, dedup_key, dedup_scope, dedup_window_ms, dedup_exclude_chain_ids,
    scheduled_at, schedule_after_ms,
    chain_trace_context, trace_context, gi.ord
  FROM unnest(
    $2::text[], $3::{{id_type}}[], $4::text[], $5::integer[],
    $6::jsonb[], $7::text[], $8::text[], $9::bigint[],
    $10::text[],
    $11::timestamptz[], $12::bigint[],
    $13::text[], $14::text[]
  ) WITH ORDINALITY AS t(
    type_name, chain_id, chain_type_name, chain_index,
    input, dedup_key, dedup_scope, dedup_window_ms, dedup_exclude_chain_ids,
    scheduled_at, schedule_after_ms,
    chain_trace_context, trace_context, ord
  )
  JOIN generated_ids gi USING (ord)
),
existing_continuations AS (
  SELECT DISTINCT ON (id2.ord) id2.ord, j.*
  FROM input_data id2
  JOIN {{schema}}.{{table_prefix}}job j
    ON id2.chain_id IS NOT NULL
    AND j.chain_id = id2.chain_id
    AND j.chain_index = id2.chain_index
    AND j.id != j.chain_id
  ORDER BY id2.ord
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
      OR (id2.dedup_scope = 'incomplete' AND j.status != 'completed')
      OR (id2.dedup_scope = 'any')
    )
    AND (
      id2.dedup_window_ms IS NULL
      OR j.created_at >= now() - (id2.dedup_window_ms || ' milliseconds')::interval
    )
    AND (
      id2.dedup_exclude_chain_ids IS NULL
      OR j.chain_id != ALL(ARRAY(SELECT jsonb_array_elements_text(id2.dedup_exclude_chain_ids::jsonb))::{{id_type}}[])
    )
  WHERE NOT EXISTS (SELECT 1 FROM existing_continuations ec WHERE ec.ord = id2.ord)
  ORDER BY id2.ord, j.created_at DESC
),
to_insert_all AS (
  SELECT id2.*
  FROM input_data id2
  WHERE NOT EXISTS (SELECT 1 FROM existing_continuations ec WHERE ec.ord = id2.ord)
    AND NOT EXISTS (SELECT 1 FROM existing_deduplicated ed WHERE ed.ord = id2.ord)
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
    ti.id, ti.type_name, COALESCE(ti.chain_id, ti.id), ti.chain_type_name,
    ti.chain_index, ti.input, ti.dedup_key,
    GREATEST(COALESCE(ti.scheduled_at, now() + (ti.schedule_after_ms || ' milliseconds')::interval, now()), now()),
    ti.chain_trace_context, ti.trace_context
  FROM to_insert ti
  ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = {{schema}}.{{table_prefix}}job.id
  RETURNING *
)
SELECT ec.ord, ec.id, ec.type_name, ec.chain_id, ec.chain_type_name, ec.chain_index, ec.input, ec.output, ec.status, ec.created_at, ec.scheduled_at, ec.completed_at, ec.completed_by, ec.attempt, ec.last_attempt_error, ec.last_attempt_at, ec.leased_by, ec.leased_until, ec.deduplication_key, ec.chain_trace_context, ec.trace_context, TRUE AS deduplicated
FROM existing_continuations ec
UNION ALL
SELECT ed.ord, ed.id, ed.type_name, ed.chain_id, ed.chain_type_name, ed.chain_index, ed.input, ed.output, ed.status, ed.created_at, ed.scheduled_at, ed.completed_at, ed.completed_by, ed.attempt, ed.last_attempt_error, ed.last_attempt_at, ed.leased_by, ed.leased_until, ed.deduplication_key, ed.chain_trace_context, ed.trace_context, TRUE AS deduplicated
FROM existing_deduplicated ed
UNION ALL
SELECT tia.ord, ij.id, ij.type_name, ij.chain_id, ij.chain_type_name, ij.chain_index, ij.input, ij.output, ij.status, ij.created_at, ij.scheduled_at, ij.completed_at, ij.completed_by, ij.attempt, ij.last_attempt_error, ij.last_attempt_at, ij.leased_by, ij.leased_until, ij.deduplication_key, ij.chain_trace_context, ij.trace_context, TRUE AS deduplicated
FROM to_insert_all tia
JOIN to_insert ti ON ti.dedup_key = tia.dedup_key AND ti.chain_type_name = tia.chain_type_name
JOIN inserted_jobs ij ON COALESCE(ti.chain_id, ti.id) = ij.chain_id AND ti.chain_index = ij.chain_index
WHERE tia.dedup_key IS NOT NULL AND tia.ord != ti.ord
UNION ALL
SELECT ti.ord, ij.id, ij.type_name, ij.chain_id, ij.chain_type_name, ij.chain_index, ij.input, ij.output, ij.status, ij.created_at, ij.scheduled_at, ij.completed_at, ij.completed_by, ij.attempt, ij.last_attempt_error, ij.last_attempt_at, ij.leased_by, ij.leased_until, ij.deduplication_key, ij.chain_trace_context, ij.trace_context, (ij.id != ti.id) AS deduplicated
FROM inserted_jobs ij JOIN to_insert ti ON COALESCE(ti.chain_id, ti.id) = ij.chain_id AND ti.chain_index = ij.chain_index
ORDER BY ord
`,
              {
                id: "createJobs",
                params: [
                  t.array(),
                  t.array(),
                  t.array<string | null>(),
                  t.array(),
                  t.array<number>(),
                  t.jsonArray(),
                  t.array<string | null>(),
                  t.array<string | null>(),
                  t.array<number | null>(),
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
          jobs.map((j) => j.chainId ?? null),
          jobs.map((j) => j.chainTypeName),
          jobs.map((j) => j.chainIndex),
          jobs.map((j) => j.input),
          jobs.map((j) => j.deduplication?.key ?? null),
          jobs.map((j) => (j.deduplication ? (j.deduplication.scope ?? "incomplete") : null)),
          jobs.map((j) => j.deduplication?.windowMs ?? null),
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
  SELECT j.id, j.chain_id, j.status
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
    lbcl.status AS blocker_status
  FROM inserted_blockers ib
  LEFT JOIN locked_blocker_chain_latest lbcl ON lbcl.chain_id = ib.blocked_by_chain_id
),
has_incomplete_blockers AS (
  SELECT DISTINCT job_id
  FROM blockers_status
  WHERE blocker_status != 'completed'
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
),
per_job_incomplete AS (
  SELECT
    bs.job_id,
    COALESCE(array_agg(bs.blocked_by_chain_id) FILTER (WHERE bs.blocker_status != 'completed'), ARRAY[]::{{id_type}}[]) AS incomplete_blocker_chain_ids
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

    unblockJobs: async ({ txCtx, blockedByChainId }) => {
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
    (
      SELECT j2.status
      FROM {{schema}}.{{table_prefix}}job j2
      WHERE j2.chain_id = jb.blocked_by_chain_id
      ORDER BY j2.chain_index DESC
      LIMIT 1
    ) AS blocker_status
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.job_id IN (SELECT job_id FROM direct_blocked)
),
ready_jobs AS (
  SELECT job_id
  FROM blockers_status
  GROUP BY job_id
  HAVING bool_and(blocker_status = 'completed')
),
updated AS (
  UPDATE {{schema}}.{{table_prefix}}job j
  SET scheduled_at = GREATEST(j.scheduled_at, now()),
    status = 'pending'
  WHERE j.id IN (SELECT job_id FROM ready_jobs)
    AND j.status = 'blocked'
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
    getJobBlockers: async ({ txCtx, jobId }) => {
      const chains = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getJobBlockers", () =>
          applyTemplate(
            sql(
              `
SELECT
  row_to_json(j)   AS root_job,
  row_to_json(lc)  AS last_chain_job
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

      return chains.map(({ root_job, last_chain_job }) => [
        mapDbJobToStateJob(root_job),
        last_chain_job ? mapDbJobToStateJob(last_chain_job) : undefined,
      ]);
    },

    getNextJobAvailableInMs: async ({ txCtx, typeNames }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getNextJobAvailableInMs", () =>
          applyTemplate(
            sql(
              `
SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (job.scheduled_at - now())) * 1000))::integer AS available_in_ms
FROM {{schema}}.{{table_prefix}}job as job
WHERE job.type_name IN (SELECT unnest($1::text[]))
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
`,
              {
                id: "getNextJobAvailableInMs",
                params: [t.array()],
                columns: { available_in_ms: t.number() },
              },
            ),
          ),
        ),
        params: [typeNames],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ txCtx, typeNames }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("acquireJob", () =>
          applyTemplate(
            sql(
              `
WITH acquired_job AS (
  SELECT id
  FROM {{schema}}.{{table_prefix}}job
  WHERE type_name IN (SELECT unnest($1::text[]))
    AND status = 'pending'
    AND scheduled_at <= now()
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE {{schema}}.{{table_prefix}}job
SET status = 'running',
  attempt = attempt + 1
WHERE id = (SELECT id FROM acquired_job)
RETURNING *,
  EXISTS(
    SELECT 1 FROM {{schema}}.{{table_prefix}}job
    WHERE type_name IN (SELECT unnest($1::text[]))
      AND status = 'pending'
      AND scheduled_at <= now()
    LIMIT 1
  ) AS has_more
`,
              {
                id: "acquireJob",
                params: [t.array()],
                columns: { ...dbJobColumns, has_more: t.boolean() },
              },
            ),
          ),
        ),
        params: [typeNames],
      });

      return result
        ? { job: mapDbJobToStateJob(result), hasMore: result.has_more }
        : { job: undefined, hasMore: false };
    },
    renewJobLease: async ({ txCtx, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("renewJobLease", () =>
          applyTemplate(
            sql(
              `
UPDATE {{schema}}.{{table_prefix}}job
SET leased_by = $2,
  leased_until = now() + ($3::bigint || ' milliseconds')::interval,
  status = 'running'
WHERE id = $1
RETURNING *
`,
              {
                id: "renewJobLease",
                params: [idDataType, t.string(), t.number()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [jobId, workerId, leaseDurationMs],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ txCtx, jobId, schedule, error }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("rescheduleJob", () =>
          applyTemplate(
            sql(
              `
UPDATE {{schema}}.{{table_prefix}}job
SET scheduled_at = GREATEST(COALESCE($2::timestamptz, now() + ($3::bigint || ' milliseconds')::interval, now()), now()),
  last_attempt_at = now(),
  last_attempt_error = $4::jsonb,
  leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = $1
RETURNING *
`,
              {
                id: "rescheduleJob",
                params: [idDataType, t["date?"](), t["number?"](), t.string()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [
          jobId,
          schedule.at?.toISOString() ?? null,
          schedule.afterMs ?? null,
          JSON.stringify(error),
        ],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ txCtx, jobId, output, workerId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("completeJob", () =>
          applyTemplate(
            sql(
              `
UPDATE {{schema}}.{{table_prefix}}job
SET status = 'completed',
  completed_at = now(),
  completed_by = $3,
  output = $2,
  leased_by = NULL,
  leased_until = NULL,
  last_attempt_error = NULL
WHERE id = $1
RETURNING *
`,
              {
                id: "completeJob",
                params: [idDataType, t.json(), t["string?"]()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [jobId, output, workerId],
      });

      return mapDbJobToStateJob(job);
    },
    reapExpiredJobLease: async ({ txCtx, typeNames, ignoredJobIds }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("reapExpiredJobLease", () =>
          applyTemplate(
            sql(
              `
WITH job_to_unlock AS (
  SELECT id
  FROM {{schema}}.{{table_prefix}}job
  WHERE leased_until IS NOT NULL
    AND leased_until <= now()
    AND status = 'running'
    AND type_name IN (SELECT unnest($1::text[]))
    AND id != ALL($2::{{id_type}}[])
  ORDER BY leased_until ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE {{schema}}.{{table_prefix}}job as job
SET leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
FROM job_to_unlock
WHERE job.id = job_to_unlock.id
RETURNING job.*
`,
              {
                id: "reapExpiredJobLease",
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
    row_to_json(root) AS root_job,
    row_to_json(lc) AS last_chain_job
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
                  deleted: t.json<{ root_job: DbJob; last_chain_job: DbJob | null }[]>(),
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
          mapDbJobToStateJob(pair.root_job),
          pair.last_chain_job && pair.last_chain_job.id !== pair.root_job.id
            ? mapDbJobToStateJob(pair.last_chain_job)
            : undefined,
        ]),
        blockerRefs: row.blocker_refs.map((r) => ({
          chainId: r.blocked_by_chain_id,
          referencedByJobId: r.job_id,
        })),
      };
    },
    listChains: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
      const conditions: string[] = ["root_job.chain_index = 0"];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];
      let p = 1;

      if (filter?.typeName?.length) {
        conditions.push(`root_job.type_name = ANY($${p}::text[])`);
        params.push(filter.typeName);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.rootOnly) {
        conditions.push(
          `NOT EXISTS (SELECT 1 FROM ${schema}.${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = root_job.chain_id)`,
        );
      }
      if (filter?.chainId?.length) {
        conditions.push(`root_job.chain_id = ANY($${p}::${idType}[])`);
        params.push(filter.chainId);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.jobId?.length) {
        conditions.push(
          `root_job.chain_id IN (SELECT chain_id FROM ${schema}.${tablePrefix}job WHERE id = ANY($${p}::${idType}[]))`,
        );
        params.push(filter.jobId);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.status?.length) {
        conditions.push(`last_job.status = ANY($${p}::${schema}.${tablePrefix}job_status[])`);
        params.push(filter.status);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.from) {
        conditions.push(`root_job.created_at >= $${p}::timestamptz`);
        params.push(filter.from);
        paramTypes.push(t["date?"]());
        p++;
      }
      if (filter?.to) {
        conditions.push(`root_job.created_at <= $${p}::timestamptz`);
        params.push(filter.to);
        paramTypes.push(t["date?"]());
        p++;
      }
      const cmp = orderDirection === "desc" ? "<" : ">";
      if (cursor) {
        conditions.push(
          `(root_job.created_at ${cmp} $${p}::timestamptz OR (root_job.created_at = $${p}::timestamptz AND root_job.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.createdAt, cursor.id);
        paramTypes.push(t["date?"](), idDataType);
        p += 2;
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const dir = orderDirection === "desc" ? "DESC" : "ASC";
      const sqlStr = `SELECT row_to_json(root_job) AS root_job, row_to_json(last_job) AS last_chain_job FROM ${schema}.${tablePrefix}job root_job LEFT JOIN LATERAL (SELECT * FROM ${schema}.${tablePrefix}job WHERE chain_id = root_job.id ORDER BY chain_index DESC LIMIT 1) last_job ON TRUE WHERE ${conditions.join(" AND ")} ORDER BY root_job.created_at ${dir}, root_job.id ${dir} LIMIT $${p}`;

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
        const rootJob = mapDbJobToStateJob(row.root_job);
        const lastJob =
          row.last_chain_job && row.last_chain_job.id !== row.root_job.id
            ? mapDbJobToStateJob(row.last_chain_job)
            : undefined;
        return [rootJob, lastJob];
      });

      const lastItem = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastItem) {
        nextCursor = encodeCursor({
          type: "createdAt",
          id: lastItem.root_job.id,
          createdAt: lastItem.root_job.created_at,
        });
      }

      return { items, nextCursor };
    },

    listJobs: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
      const conditions: string[] = [];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];
      let p = 1;

      if (filter?.status?.length) {
        conditions.push(`j.status = ANY($${p}::${schema}.${tablePrefix}job_status[])`);
        params.push(filter.status);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.typeName?.length) {
        conditions.push(`j.type_name = ANY($${p}::text[])`);
        params.push(filter.typeName);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.chainTypeName?.length) {
        conditions.push(`j.chain_type_name = ANY($${p}::text[])`);
        params.push(filter.chainTypeName);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.chainId?.length) {
        conditions.push(`j.chain_id = ANY($${p}::${idType}[])`);
        params.push(filter.chainId);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.jobId?.length) {
        conditions.push(`j.id = ANY($${p}::${idType}[])`);
        params.push(filter.jobId);
        paramTypes.push(t.array());
        p++;
      }
      if (filter?.from) {
        conditions.push(`j.created_at >= $${p}::timestamptz`);
        params.push(filter.from);
        paramTypes.push(t["date?"]());
        p++;
      }
      if (filter?.to) {
        conditions.push(`j.created_at <= $${p}::timestamptz`);
        params.push(filter.to);
        paramTypes.push(t["date?"]());
        p++;
      }
      const cmp = orderDirection === "desc" ? "<" : ">";
      if (cursor) {
        conditions.push(
          `(j.created_at ${cmp} $${p}::timestamptz OR (j.created_at = $${p}::timestamptz AND j.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.createdAt, cursor.id);
        paramTypes.push(t["date?"](), idDataType);
        p += 2;
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const dir = orderDirection === "desc" ? "DESC" : "ASC";
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j ${where} ORDER BY j.created_at ${dir}, j.id ${dir} LIMIT $${p}`;

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
          type: "createdAt",
          id: lastRow.id,
          createdAt: lastRow.created_at,
        });
      }

      return { items, nextCursor };
    },

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeChainIndexCursor(page.cursor) : null;
      const conditions: string[] = [`j.chain_id = $1::${idType}`];
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [idDataType];
      let p = 2;

      const cmp = orderDirection === "asc" ? ">" : "<";
      if (cursor) {
        conditions.push(
          `(j.chain_index ${cmp} $${p}::integer OR (j.chain_index = $${p}::integer AND j.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.chainIndex, cursor.id);
        paramTypes.push(t.number(), idDataType);
        p += 2;
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const dir = orderDirection === "asc" ? "ASC" : "DESC";
      const sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.chain_index ${dir}, j.id ${dir} LIMIT $${p}`;

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
          type: "chainIndex",
          id: lastRow.id,
          chainIndex: lastRow.chain_index,
        });
      }

      return { items, nextCursor };
    },

    triggerJobs: async ({ txCtx, jobIds }) => {
      if (jobIds.length === 0) return [];
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("triggerJobs", () =>
          applyTemplate(
            sql(
              `
UPDATE {{schema}}.{{table_prefix}}job
SET scheduled_at = now()
WHERE id = ANY($1::{{id_type}}[])
  AND status = 'pending'
RETURNING *
`,
              {
                id: "triggerJobs",
                params: [t.array()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [jobIds as string[]],
      });
      const orderById = new Map(jobIds.map((id, i) => [id as string, i]));
      return rows
        .slice()
        .sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!)
        .map(mapDbJobToStateJob);
    },

    close: async () => {
      await stateProvider.close?.();
    },

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
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
        params.push(cursor.createdAt, cursor.id);
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
          type: "createdAt",
          id: lastRow.id,
          createdAt: lastRow.created_at,
        });
      }

      return { items, nextCursor };
    },
    migrateToLatest: async () => {
      return executeMigrations<TTxContext>({
        migrations,
        runInTransaction: stateProvider.withTransaction,
        getAppliedMigrationNames: async (txCtx) => {
          await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(
                `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}migration (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
                { id: "createMigrationTable", params: [], columns: {} },
              ),
            ),
          });
          const applied = await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(
                `SELECT name, applied_at FROM {{schema}}.{{table_prefix}}migration ORDER BY name`,
                {
                  id: "getAppliedMigrations",
                  params: [],
                  columns: { name: t.string(), applied_at: t.string() },
                  readOnly: true,
                },
              ),
            ),
          });
          return applied.map((m) => m.name);
        },
        executeMigrationStatements: async (txCtx, migration) => {
          for (const stmt of migration.statements) {
            await executeTypedSql({ txCtx, sql: applyTemplate(stmt.sql), params: [] });
          }
        },
        recordMigration: async (txCtx, name) => {
          await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(
                `INSERT INTO {{schema}}.{{table_prefix}}migration (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
                { id: "recordMigration", params: [t.string()], columns: {} },
              ),
            ),
            params: [name],
          });
        },
      });
    },
    vacuum: async () => {
      await executeTypedSql({
        sql: applyTemplate(sql(`VACUUM ${schema}.${tablePrefix}job`, { params: [], columns: {} })),
      });
      await executeTypedSql({
        sql: applyTemplate(
          sql(`VACUUM ${schema}.${tablePrefix}job_blocker`, { params: [], columns: {} }),
        ),
      });
    },
    truncate: async () => {
      await executeTypedSql({
        sql: applyTemplate(
          sql(`TRUNCATE ${schema}.${tablePrefix}job_blocker, ${schema}.${tablePrefix}job CASCADE`, {
            params: [],
            columns: {},
          }),
        ),
      });
    },
  };
};

/** PostgreSQL state adapter type. Includes `migrateToLatest` for schema migrations, `vacuum` for on-demand dead tuple reclamation, and `truncate` for clearing all job data. */
export type PgStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
> = StateAdapter<TTxContext, TJobId> & {
  migrateToLatest: () => Promise<MigrationResult>;
  vacuum: () => Promise<void>;
  truncate: () => Promise<void>;
};
