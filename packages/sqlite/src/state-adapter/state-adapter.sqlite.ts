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

import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

const jobColumns = [
  "id",
  "type_name",
  "chain_id",
  "chain_type_name",
  "chain_index",
  "input",
  "output",
  "status",
  "created_at",
  "scheduled_at",
  "completed_at",
  "completed_by",
  "attempt",
  "last_attempt_at",
  "last_attempt_error",
  "leased_by",
  "leased_until",
  "deduplication_key",
  "chain_trace_context",
  "trace_context",
] as const;

const jobColumnsSelect = (alias: string): string =>
  jobColumns.map((c) => `${alias}.${c}`).join(", ");

const jobColumnsPrefixedSelect = (alias: string, prefix: string): string =>
  jobColumns.map((c) => `${alias}.${c} AS ${prefix}${c}`).join(", ");

type DbJob = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_type_name: string;
  chain_index: number;
  input: string | null;
  output: string | null;

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

type DbChainRow = DbJob & {
  [K in keyof DbJob as `lc_${K}`]: DbJob[K] | null;
};

const migrations: Migration[] = [
  {
    name: "20240101000000_initial_schema",
    transactional: true,
    statements: [
      {
        sql: sql(`
CREATE TABLE IF NOT EXISTS {{table_prefix}}job (
  id                            {{id_type}} PRIMARY KEY,
  type_name                     TEXT NOT NULL,
  chain_id                      {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  chain_type_name               TEXT NOT NULL,
  chain_index                   INTEGER NOT NULL,

  input                         TEXT,
  output                        TEXT,

  -- state
  status                        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('blocked','pending','running','completed')),
  created_at                    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  scheduled_at                  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  completed_at                  TEXT,
  completed_by                  TEXT,

  -- attempts
  attempt                       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at               TEXT,
  last_attempt_error            TEXT,

  -- leasing
  leased_by                     TEXT,
  leased_until                  TEXT,

  -- deduplication
  deduplication_key             TEXT,

  -- tracing
  chain_trace_context           TEXT,
  trace_context                 TEXT
)`),
      },
      {
        sql: sql(`
CREATE TABLE IF NOT EXISTS {{table_prefix}}job_blocker (
  job_id                        {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  -- NOTE: requires PRAGMA foreign_keys = ON (SQLite default is OFF)
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  "index"                       INTEGER NOT NULL,
  trace_context                 TEXT,
  PRIMARY KEY (job_id, blocked_by_chain_id)
)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_acquisition_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      },
      {
        sql: sql(`
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}job_chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_expired_lease_idx
ON {{table_prefix}}job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_idx
ON {{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_idx
ON {{table_prefix}}job (created_at DESC)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_status_idx
ON {{table_prefix}}job (status, created_at DESC)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_type_name_idx
ON {{table_prefix}}job (type_name, created_at DESC)`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_type_name_idx
ON {{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`),
      },
    ],
  },
  {
    name: "20260430000000_rename_chain_indexes",
    transactional: true,
    statements: [
      {
        sql: sql(`DROP INDEX IF EXISTS {{table_prefix}}job_chain_index_idx`),
      },
      {
        sql: sql(`
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)`),
      },
      {
        sql: sql(`DROP INDEX IF EXISTS {{table_prefix}}job_chain_listing_idx`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_listing_idx
ON {{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      },
      {
        sql: sql(`DROP INDEX IF EXISTS {{table_prefix}}job_chain_listing_type_name_idx`),
      },
      {
        sql: sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_listing_type_name_idx
ON {{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`),
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

const isoToSqlite = (iso: string): string => iso.replace("T", " ").replace("Z", "");

const parseJson = (value: string | null): unknown => {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const mapDbJobToStateJob = (dbJob: DbJob): StateJob => {
  return {
    id: dbJob.id,
    typeName: dbJob.type_name,
    chainId: dbJob.chain_id,
    chainTypeName: dbJob.chain_type_name,
    chainIndex: dbJob.chain_index,
    input: parseJson(dbJob.input),
    output: parseJson(dbJob.output),

    status: dbJob.status,
    createdAt: new Date(dbJob.created_at + "Z"),
    scheduledAt: new Date(dbJob.scheduled_at + "Z"),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at + "Z") : null,
    completedBy: dbJob.completed_by,

    attempt: dbJob.attempt,
    lastAttemptError: parseJson(dbJob.last_attempt_error) as string | null,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at + "Z") : null,

    leasedBy: dbJob.leased_by,
    leasedUntil: dbJob.leased_until ? new Date(dbJob.leased_until + "Z") : null,

    deduplicationKey: dbJob.deduplication_key,

    chainTraceContext: dbJob.chain_trace_context,
    traceContext: dbJob.trace_context,
  };
};

const parseDbChainRow = (row: DbChainRow): { rootJob: DbJob; lastChainJob: DbJob | null } => {
  const rootJob: DbJob = {
    id: row.id,
    type_name: row.type_name,
    chain_id: row.chain_id,
    chain_type_name: row.chain_type_name,
    chain_index: row.chain_index,
    input: row.input,
    output: row.output,
    status: row.status,
    created_at: row.created_at,
    scheduled_at: row.scheduled_at,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
    attempt: row.attempt,
    last_attempt_at: row.last_attempt_at,
    last_attempt_error: row.last_attempt_error,
    leased_by: row.leased_by,
    leased_until: row.leased_until,
    deduplication_key: row.deduplication_key,
    chain_trace_context: row.chain_trace_context,
    trace_context: row.trace_context,
  };

  const lastChainJob: DbJob | null = row.lc_id
    ? {
        id: row.lc_id,
        type_name: row.lc_type_name!,
        chain_id: row.lc_chain_id!,
        chain_type_name: row.lc_chain_type_name!,
        chain_index: row.lc_chain_index!,
        input: row.lc_input,
        output: row.lc_output,
        status: row.lc_status!,
        created_at: row.lc_created_at!,
        scheduled_at: row.lc_scheduled_at!,
        completed_at: row.lc_completed_at,
        completed_by: row.lc_completed_by,
        attempt: row.lc_attempt!,
        last_attempt_at: row.lc_last_attempt_at,
        last_attempt_error: row.lc_last_attempt_error,
        leased_by: row.lc_leased_by,
        leased_until: row.lc_leased_until,
        deduplication_key: row.lc_deduplication_key,
        chain_trace_context: row.lc_chain_trace_context,
        trace_context: row.lc_trace_context,
      }
    : null;

  return { rootJob, lastChainJob };
};

/**
 * Create a state adapter backed by SQLite. Returns the adapter with a `migrateToLatest()` method for schema migrations.
 * @experimental
 */
export const createSqliteStateAdapter = async <
  TTxContext extends BaseTxContext,
  TIdType extends string = UUID,
>({
  stateProvider,
  tablePrefix = "queuert_",
  idType = "TEXT",
  generateId: generateIdOption = () => crypto.randomUUID() as TIdType,
  validateId: validateIdOption,
  checkForeignKeys = true,
  checkAutoVacuum = true,
}: {
  /** SQLite state provider wrapping the database connection. */
  stateProvider: SqliteStateProvider<TTxContext>;
  /** Prefix for all table names. @defaultValue `"queuert_"` */
  tablePrefix?: string;
  /** SQL type for the primary key column. @defaultValue `"TEXT"` */
  idType?: string;
  /** Function to generate new job IDs. @defaultValue `() => crypto.randomUUID()` */
  generateId?: () => TIdType;
  /** Predicate returning `true` if the ID is acceptable. Runs on both generated and caller-supplied IDs; failures throw `InvalidJobIdError`. */
  validateId?: (id: TIdType) => boolean;
  /** Whether `migrateToLatest()` verifies that `PRAGMA foreign_keys = ON` is set. Disable only if foreign keys are managed externally. @defaultValue `true` */
  checkForeignKeys?: boolean;
  /** Whether `migrateToLatest()` verifies that `PRAGMA auto_vacuum = INCREMENTAL` is set. Required for `vacuum()` to reclaim disk space. @defaultValue `true` */
  checkAutoVacuum?: boolean;
}): Promise<
  StateAdapter<TTxContext, TIdType> & {
    migrateToLatest: () => Promise<MigrationResult>;
    vacuum: () => Promise<void>;
    truncate: () => Promise<void>;
  }
> => {
  validateSqlIdentifier(tablePrefix, "tablePrefix");
  validateSqlIdentifier(idType, "idType");

  const { validateId, generateId } = createIdValidator<TIdType>({
    generateIdOption,
    validateIdOption,
  });

  const applyTemplate = createTemplateApplier(
    { table_prefix: tablePrefix, id_type: idType },
    {
      job_columns: jobColumnsSelect,
      job_columns_prefixed: jobColumnsPrefixedSelect,
    },
  );

  const templateCache = createTemplateCache();

  const idDataType = t.string();
  const dbJobColumns = {
    id: idDataType,
    chain_id: idDataType,
    type_name: t.string(),
    chain_type_name: t.string(),
    chain_index: t.number(),
    input: t["string?"](),
    output: t["string?"](),
    status: t.string<DbJob["status"]>(),
    created_at: t.string(),
    scheduled_at: t.string(),
    completed_at: t["string?"](),
    completed_by: t["string?"](),
    attempt: t.number(),
    last_attempt_error: t["string?"](),
    last_attempt_at: t["string?"](),
    leased_by: t["string?"](),
    leased_until: t["string?"](),
    deduplication_key: t["string?"](),
    chain_trace_context: t["string?"](),
    trace_context: t["string?"](),
  } as const;

  const dbChainRowColumns = {
    ...dbJobColumns,
    lc_id: t["string?"](),
    lc_type_name: t["string?"](),
    lc_chain_id: t["string?"](),
    lc_chain_type_name: t["string?"](),
    lc_chain_index: t["number?"](),
    lc_input: t["string?"](),
    lc_output: t["string?"](),
    lc_status: t["string?"]<DbJob["status"]>(),
    lc_created_at: t["string?"](),
    lc_scheduled_at: t["string?"](),
    lc_completed_at: t["string?"](),
    lc_completed_by: t["string?"](),
    lc_attempt: t["number?"](),
    lc_last_attempt_error: t["string?"](),
    lc_last_attempt_at: t["string?"](),
    lc_leased_by: t["string?"](),
    lc_leased_until: t["string?"](),
    lc_deduplication_key: t["string?"](),
    lc_chain_trace_context: t["string?"](),
    lc_trace_context: t["string?"](),
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
  SELECT value AS chain_id FROM json_each(?)
  UNION
  -- jb.job_id = chain_id because blockers are added to the root job whose id = chain_id
  SELECT jb.blocked_by_chain_id AS chain_id
  FROM {{table_prefix}}job_blocker jb
  JOIN connected c ON jb.job_id = c.chain_id
)
SELECT chain_id FROM connected
`,
            {
              id: "getConnectedChainIds",
              params: [t.string()],
              columns: { chain_id: idDataType },
              readOnly: true,
            },
          ),
        ),
      ),
      params: [JSON.stringify(chainIds)],
    });
    return connected.map((r) => r.chain_id) as TIdType[];
  };

  const getExternalBlockerRefs = async (
    txCtx: TTxContext | undefined,
    effectiveChainIds: readonly TIdType[],
  ): Promise<{ chainId: string; referencedByJobId: string }[]> => {
    if (effectiveChainIds.length === 0) return [];
    const idsJson = JSON.stringify(effectiveChainIds);
    const refs = await executeTypedSql({
      txCtx,
      sql: templateCache.getOrCompute("checkExternalBlockerRefs", () =>
        applyTemplate(
          sql(
            `
SELECT jb.job_id, jb.blocked_by_chain_id
FROM {{table_prefix}}job_blocker jb
JOIN {{table_prefix}}job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id IN (SELECT value FROM json_each(?))
  AND j.chain_id NOT IN (SELECT value FROM json_each(?))
`,
            {
              id: "checkExternalBlockerRefs",
              params: [t.string(), t.string()],
              columns: { job_id: idDataType, blocked_by_chain_id: idDataType },
              readOnly: true,
            },
          ),
        ),
      ),
      params: [idsJson, idsJson],
    });
    return refs.map((r) => ({
      chainId: r.blocked_by_chain_id,
      referencedByJobId: r.job_id,
    }));
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
      const idsJson = JSON.stringify(chainIds);
      if (lock === "exclusive" && txCtx) {
        await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("getChainsLocked", () =>
            applyTemplate(
              sql(
                `
UPDATE {{table_prefix}}job
SET id = id
WHERE id IN (
  SELECT j.id FROM {{table_prefix}}job j
  WHERE j.chain_id IN (SELECT value FROM json_each(?))
    AND j.chain_index = (
      SELECT MAX(chain_index) FROM {{table_prefix}}job WHERE chain_id = j.chain_id
    )
)
`,
                {
                  id: "getChainsLocked",
                  params: [t.string()],
                  columns: {} as Record<string, never>,
                },
              ),
            ),
          ),
          params: [idsJson],
        });
      }
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getChains", () =>
          applyTemplate(
            sql(
              `
SELECT
  {{job_columns:j}},
  {{job_columns_prefixed:lc:lc_}}
FROM {{table_prefix}}job AS j
LEFT JOIN {{table_prefix}}job AS lc
  ON lc.chain_id = j.id
  AND lc.chain_index = (
    SELECT MAX(chain_index) FROM {{table_prefix}}job WHERE chain_id = j.id
  )
WHERE j.id IN (SELECT value FROM json_each(?))
ORDER BY j.id
`,
              {
                id: "getChains",
                params: [t.string()],
                columns: { ...dbChainRowColumns },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [idsJson],
      });
      const byId = new Map<string, { rootJob: DbJob; lastChainJob: DbJob | null }>();
      for (const row of rows) {
        const parsed = parseDbChainRow(row);
        byId.set(parsed.rootJob.id, parsed);
      }
      return chainIds.map((chainId): [StateJob, StateJob | undefined] | undefined => {
        const parsed = byId.get(chainId as string);
        if (!parsed) return undefined;
        const { rootJob, lastChainJob } = parsed;
        return [
          mapDbJobToStateJob(rootJob),
          lastChainJob && lastChainJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastChainJob)
            : undefined,
        ];
      });
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
      const lockedSql =
        lock === "exclusive" && txCtx
          ? templateCache.getOrCompute("getJobsLocked", () =>
              applyTemplate(
                sql(
                  `
UPDATE {{table_prefix}}job
SET id = id
WHERE id IN (SELECT value FROM json_each(?))
RETURNING *
`,
                  {
                    id: "getJobsLocked",
                    params: [t.string()],
                    columns: { ...dbJobColumns },
                  },
                ),
              ),
            )
          : templateCache.getOrCompute("getJobs", () =>
              applyTemplate(
                sql(
                  `
SELECT *
FROM {{table_prefix}}job
WHERE id IN (SELECT value FROM json_each(?))
`,
                  {
                    id: "getJobs",
                    params: [t.string()],
                    columns: { ...dbJobColumns },
                    readOnly: true,
                  },
                ),
              ),
            );
      const idsJson = JSON.stringify(jobIds);
      const rows = await executeTypedSql({ txCtx, sql: lockedSql, params: [idsJson] });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return jobIds.map((jobId): StateJob | undefined => {
        const row = byId.get(jobId as string);
        return row ? mapDbJobToStateJob(row) : undefined;
      });
    }) as StateAdapter<TTxContext, TIdType>["getJobs"],

    createJobs: async ({ txCtx, jobs }) => {
      for (const job of jobs) {
        if (job.id !== undefined) validateId(job.id, "caller");
      }
      const results: { job: StateJob; deduplicated: boolean }[] = Array.from({
        length: jobs.length,
      });
      const toInsert: { index: number; id: string; json: Record<string, unknown> }[] = [];
      const intraBatchDedup = new Map<string, number>();
      const deferredDupes: { index: number; firstIndex: number }[] = [];

      for (let i = 0; i < jobs.length; i++) {
        const {
          typeName,
          id: providedId,
          chainTypeName,
          chainIndex,
          input,
          chainId,
          deduplication,
          schedule,
          chainTraceContext,
          traceContext,
        } = jobs[i];
        const deduplicationKey = deduplication?.key ?? null;
        const deduplicationScope = deduplication ? (deduplication.scope ?? "incomplete") : null;
        const deduplicationWindowMs = deduplication?.windowMs ?? null;
        const deduplicationExcludeChainIds = deduplication?.excludeChainIds
          ? JSON.stringify(deduplication.excludeChainIds)
          : null;

        if (chainId) {
          const [existingContinuation] = await executeTypedSql({
            txCtx,
            sql: templateCache.getOrCompute("findExistingContinuation", () =>
              applyTemplate(
                sql(
                  `
SELECT *, 1 AS deduplicated
FROM {{table_prefix}}job
WHERE chain_id = ? AND chain_index = ? AND id != chain_id
LIMIT 1
`,
                  {
                    id: "findExistingContinuation",
                    params: [idDataType, t.number()],
                    columns: { ...dbJobColumns, deduplicated: t.number() },
                    readOnly: true,
                  },
                ),
              ),
            ),
            params: [chainId, chainIndex],
          });

          if (existingContinuation) {
            results[i] = { job: mapDbJobToStateJob(existingContinuation), deduplicated: true };
            continue;
          }
        } else if (deduplicationKey) {
          const batchKey = `${deduplicationKey}\0${chainTypeName}`;
          const firstIdx = intraBatchDedup.get(batchKey);
          if (firstIdx !== undefined) {
            deferredDupes.push({ index: i, firstIndex: firstIdx });
            continue;
          }

          const [existingDeduplicated] = await executeTypedSql({
            txCtx,
            sql: templateCache.getOrCompute("findDeduplicatedJob", () =>
              applyTemplate(
                sql(
                  `
SELECT *, 1 AS deduplicated
FROM {{table_prefix}}job
WHERE ? IS NOT NULL
  AND deduplication_key = ?
  AND chain_index = 0
  AND chain_type_name = ?
  AND (
    ? IS NULL
    OR (? = 'incomplete' AND status != 'completed')
    OR (? = 'any')
  )
  AND (
    ? IS NULL
    OR created_at >= datetime('now', 'subsec', '-' || (? / 1000.0) || ' seconds')
  )
  AND (
    ? IS NULL
    OR chain_id NOT IN (SELECT value FROM json_each(?))
  )
ORDER BY created_at DESC
LIMIT 1
`,
                  {
                    id: "findDeduplicatedJob",
                    params: [
                      t["string?"](),
                      t["string?"](),
                      t.string(),
                      t["string?"](),
                      t["string?"](),
                      t["string?"](),
                      t["number?"](),
                      t["number?"](),
                      t["string?"](),
                      t["string?"](),
                    ],
                    columns: { ...dbJobColumns, deduplicated: t.number() },
                    readOnly: true,
                  },
                ),
              ),
            ),
            params: [
              deduplicationKey,
              deduplicationKey,
              chainTypeName,
              deduplicationScope,
              deduplicationScope,
              deduplicationScope,
              deduplicationWindowMs,
              deduplicationWindowMs,
              deduplicationExcludeChainIds,
              deduplicationExcludeChainIds,
            ],
          });

          if (existingDeduplicated) {
            results[i] = { job: mapDbJobToStateJob(existingDeduplicated), deduplicated: true };
            continue;
          }

          intraBatchDedup.set(batchKey, i);
        }

        const newId = providedId ?? generateId();
        toInsert.push({
          index: i,
          id: newId,
          json: {
            id: newId,
            type_name: typeName,
            chain_id: chainId ?? null,
            chain_type_name: chainTypeName,
            chain_index: chainIndex,
            input: input !== undefined ? JSON.stringify(input) : null,
            deduplication_key: deduplicationKey,
            scheduled_at: schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null,
            schedule_after_ms: schedule?.afterMs ?? null,
            chain_trace_context: chainTraceContext ?? null,
            trace_context: traceContext ?? null,
          },
        });
      }

      if (toInsert.length > 0) {
        const insertedRows = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("insertJobs", () =>
            applyTemplate(
              sql(
                `
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_type_name, chain_index, input, deduplication_key, scheduled_at, chain_trace_context, trace_context)
SELECT
  json_extract(je.value, '$.id'),
  json_extract(je.value, '$.type_name'),
  COALESCE(json_extract(je.value, '$.chain_id'), json_extract(je.value, '$.id')),
  json_extract(je.value, '$.chain_type_name'),
  json_extract(je.value, '$.chain_index'),
  json_extract(je.value, '$.input'),
  json_extract(je.value, '$.deduplication_key'),
  MAX(
    COALESCE(
      json_extract(je.value, '$.scheduled_at'),
      CASE WHEN json_extract(je.value, '$.schedule_after_ms') IS NOT NULL
        THEN datetime('now', 'subsec', '+' || (json_extract(je.value, '$.schedule_after_ms') / 1000.0) || ' seconds')
        ELSE NULL
      END,
      datetime('now', 'subsec')
    ),
    datetime('now', 'subsec')
  ),
  json_extract(je.value, '$.chain_trace_context'),
  json_extract(je.value, '$.trace_context')
FROM json_each(?) AS je
WHERE true
ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = {{table_prefix}}job.id
RETURNING *
`,
                {
                  id: "insertJobs",
                  params: [t.string()],
                  columns: { ...dbJobColumns },
                },
              ),
            ),
          ),
          params: [JSON.stringify(toInsert.map((item) => item.json))],
        });

        for (let j = 0; j < toInsert.length; j++) {
          const row = insertedRows[j];
          results[toInsert[j].index] = {
            job: mapDbJobToStateJob(row),
            deduplicated: row.id !== toInsert[j].id,
          };
        }
      }

      for (const { index, firstIndex } of deferredDupes) {
        results[index] = { job: results[firstIndex].job, deduplicated: true };
      }

      return results;
    },

    addJobsBlockers: async ({ txCtx, jobBlockers }) => {
      const results: {
        job: StateJob;
        incompleteBlockerChainIds: string[];
        blockerChainTraceContexts: (string | null)[];
      }[] = [];

      for (const { jobId, blockedByChainIds, blockerTraceContexts } of jobBlockers) {
        const traceContextsJson = JSON.stringify(blockerTraceContexts ?? []);

        await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("insertJobBlockers", () =>
            applyTemplate(
              sql(
                `
INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT ?, je.value, je.key, json_extract(?, '$[' || je.key || ']')
FROM json_each(?) AS je
`,
                {
                  id: "insertJobBlockers",
                  params: [idDataType, t.string(), t.string()],
                  columns: {},
                },
              ),
            ),
          ),
          params: [jobId, traceContextsJson, JSON.stringify(blockedByChainIds)],
        });

        const blockerStatuses = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("checkBlockersStatus", () =>
            applyTemplate(
              sql(
                `
SELECT
  jb.job_id,
  jb.blocked_by_chain_id,
  (
    SELECT j2.status
    FROM {{table_prefix}}job j2
    WHERE j2.chain_id = jb.blocked_by_chain_id
    ORDER BY j2.chain_index DESC
    LIMIT 1
  ) AS blocker_status
FROM {{table_prefix}}job_blocker jb
WHERE jb.job_id = ?
`,
                {
                  id: "checkBlockersStatus",
                  params: [idDataType],
                  columns: {
                    job_id: idDataType,
                    blocked_by_chain_id: idDataType,
                    blocker_status: t.string(),
                  },
                  readOnly: true,
                },
              ),
            ),
          ),
          params: [jobId],
        });

        const chainTraceContextRows = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("getBlockerChainTraceContexts", () =>
            applyTemplate(
              sql(
                `
SELECT j.id AS blocked_by_chain_id, j.chain_trace_context
FROM {{table_prefix}}job j
WHERE j.id IN (SELECT value FROM json_each(?))
ORDER BY j.id
`,
                {
                  id: "getBlockerChainTraceContexts",
                  params: [t.string()],
                  columns: { blocked_by_chain_id: idDataType, chain_trace_context: t["string?"]() },
                  readOnly: true,
                },
              ),
            ),
          ),
          params: [JSON.stringify(blockedByChainIds)],
        });

        const chainTraceContextMap = new Map(
          chainTraceContextRows.map((r) => [r.blocked_by_chain_id, r.chain_trace_context]),
        );
        const blockerChainTraceContexts = blockedByChainIds.map(
          (id) => chainTraceContextMap.get(id) ?? null,
        );

        const incompleteBlockerChainIds = blockerStatuses
          .filter((b) => b.blocker_status !== "completed")
          .map((b) => b.blocked_by_chain_id);

        if (incompleteBlockerChainIds.length > 0) {
          const [updatedJob] = await executeTypedSql({
            txCtx,
            sql: templateCache.getOrCompute("updateJobToBlocked", () =>
              applyTemplate(
                sql(
                  `
UPDATE {{table_prefix}}job
SET status = 'blocked'
WHERE id = ? AND status = 'pending'
RETURNING *
`,
                  {
                    id: "updateJobToBlocked",
                    params: [idDataType],
                    columns: { ...dbJobColumns },
                  },
                ),
              ),
            ),
            params: [jobId],
          });
          if (updatedJob) {
            results.push({
              job: mapDbJobToStateJob(updatedJob),
              incompleteBlockerChainIds,
              blockerChainTraceContexts,
            });
            continue;
          }
        }

        const [job] = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("getJobForBlockers", () =>
            applyTemplate(
              sql(`SELECT * FROM {{table_prefix}}job WHERE id = ?`, {
                id: "getJobForBlockers",
                params: [idDataType],
                columns: { ...dbJobColumns },
                readOnly: true,
              }),
            ),
          ),
          params: [jobId],
        });
        results.push({
          job: mapDbJobToStateJob(job),
          incompleteBlockerChainIds: [],
          blockerChainTraceContexts,
        });
      }

      return results;
    },

    unblockJobs: async ({ txCtx, blockedByChainId }) => {
      const readyJobs = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("findReadyJobs", () =>
          applyTemplate(
            sql(
              `
WITH direct_blocked AS (
  SELECT DISTINCT jb.job_id
  FROM {{table_prefix}}job_blocker jb
  WHERE jb.blocked_by_chain_id = ?
),
blockers_status AS (
  SELECT
    jb.job_id,
    jb.blocked_by_chain_id,
    (
      SELECT j2.status
      FROM {{table_prefix}}job j2
      WHERE j2.chain_id = jb.blocked_by_chain_id
      ORDER BY j2.chain_index DESC
      LIMIT 1
    ) AS blocker_status
  FROM {{table_prefix}}job_blocker jb
  WHERE jb.job_id IN (SELECT job_id FROM direct_blocked)
)
SELECT job_id
FROM blockers_status
GROUP BY job_id
HAVING MIN(CASE WHEN blocker_status = 'completed' THEN 1 ELSE 0 END) = 1
`,
              {
                id: "findReadyJobs",
                params: [idDataType],
                columns: { job_id: idDataType },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [blockedByChainId],
      });

      const readyJobIds = readyJobs.map((r) => r.job_id);
      let unblockedJobs: StateJob[];
      if (readyJobIds.length > 0) {
        const updatedJobs = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("scheduleBlockedJobs", () =>
            applyTemplate(
              sql(
                `
UPDATE {{table_prefix}}job
SET scheduled_at = MAX(scheduled_at, datetime('now', 'subsec')),
  status = 'pending'
WHERE id IN (SELECT value FROM json_each(?)) AND status = 'blocked'
RETURNING *
`,
                {
                  id: "scheduleBlockedJobs",
                  params: [t.string()],
                  columns: { ...dbJobColumns },
                },
              ),
            ),
          ),
          params: [JSON.stringify(readyJobIds)],
        });
        unblockedJobs = updatedJobs.map(mapDbJobToStateJob);
      } else {
        unblockedJobs = [];
      }

      const traceContextResults = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getJobBlockerTraceContexts", () =>
          applyTemplate(
            sql(
              `
SELECT jb.trace_context
FROM {{table_prefix}}job_blocker jb
WHERE jb.blocked_by_chain_id = ?
  AND jb.trace_context IS NOT NULL
`,
              {
                id: "getJobBlockerTraceContexts",
                params: [idDataType],
                columns: { trace_context: t["string?"]() },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [blockedByChainId],
      });
      const blockerTraceContexts = traceContextResults.map((r) => r.trace_context);

      return { unblockedJobs, blockerTraceContexts };
    },
    getJobBlockers: async ({ txCtx, jobId }) => {
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getJobBlockers", () =>
          applyTemplate(
            sql(
              `
SELECT
  {{job_columns:j}},
  {{job_columns_prefixed:lc:lc_}}
FROM {{table_prefix}}job_blocker AS b
JOIN {{table_prefix}}job AS j
  ON j.id = b.blocked_by_chain_id
LEFT JOIN {{table_prefix}}job AS lc
  ON lc.chain_id = j.id
  AND lc.chain_index = (
    SELECT MAX(lj.chain_index)
    FROM {{table_prefix}}job lj
    WHERE lj.chain_id = j.id
  )
WHERE b.job_id = ?
ORDER BY b."index" ASC
`,
              {
                id: "getJobBlockers",
                params: [idDataType],
                columns: { ...dbChainRowColumns },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [jobId],
      });

      return rows.map((row) => {
        const { rootJob, lastChainJob } = parseDbChainRow(row);
        return [
          mapDbJobToStateJob(rootJob),
          lastChainJob && lastChainJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastChainJob)
            : undefined,
        ];
      });
    },

    getNextJobAvailableInMs: async ({ txCtx, typeNames }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getNextJobAvailableInMs", () =>
          applyTemplate(
            sql(
              `
SELECT
  MAX(0, CAST((julianday(job.scheduled_at) - julianday(datetime('now', 'subsec'))) * 86400000 AS INTEGER)) AS available_in_ms
FROM {{table_prefix}}job as job INDEXED BY {{table_prefix}}job_acquisition_idx
WHERE job.type_name IN (SELECT value FROM json_each(?))
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
`,
              {
                id: "getNextJobAvailableInMs",
                params: [t.string()],
                columns: { available_in_ms: t.number() },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [JSON.stringify(typeNames)],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ txCtx, typeNames }) => {
      const typeNamesJson = JSON.stringify(typeNames);
      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("acquireJob", () =>
          applyTemplate(
            sql(
              `
UPDATE {{table_prefix}}job
SET status = 'running',
  attempt = attempt + 1
WHERE id = (
  SELECT id
  FROM {{table_prefix}}job INDEXED BY {{table_prefix}}job_acquisition_idx
  WHERE type_name IN (SELECT value FROM json_each(?))
    AND status = 'pending'
    AND scheduled_at <= datetime('now', 'subsec')
  ORDER BY scheduled_at ASC
  LIMIT 1
)
RETURNING *,
  EXISTS(
    SELECT 1
    FROM {{table_prefix}}job INDEXED BY {{table_prefix}}job_acquisition_idx
    WHERE type_name IN (SELECT value FROM json_each(?))
      AND status = 'pending'
      AND scheduled_at <= datetime('now', 'subsec')
    LIMIT 1
  ) AS has_more
`,
              {
                id: "acquireJob",
                params: [t.string(), t.string()],
                columns: { ...dbJobColumns, has_more: t.number() },
              },
            ),
          ),
        ),
        params: [typeNamesJson, typeNamesJson],
      });

      return result
        ? { job: mapDbJobToStateJob(result), hasMore: result.has_more === 1 }
        : { job: undefined, hasMore: false };
    },
    renewJobLease: async ({ txCtx, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("renewJobLease", () =>
          applyTemplate(
            sql(
              `
UPDATE {{table_prefix}}job
SET leased_by = ?,
  leased_until = datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds'),
  status = 'running'
WHERE id = ?
RETURNING *
`,
              {
                id: "renewJobLease",
                params: [t.string(), t.number(), idDataType],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [workerId, leaseDurationMs, jobId],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ txCtx, jobId, schedule, error }) => {
      const scheduledAtIso = schedule.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
      const scheduleAfterMsOrNull = schedule.afterMs ?? null;
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("rescheduleJob", () =>
          applyTemplate(
            sql(
              `
UPDATE {{table_prefix}}job
SET scheduled_at = MAX(
    COALESCE(?,
      CASE WHEN ? IS NOT NULL THEN datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds') ELSE NULL END,
      datetime('now', 'subsec')),
    datetime('now', 'subsec')),
  last_attempt_at = datetime('now', 'subsec'),
  last_attempt_error = ?,
  leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = ?
RETURNING *
`,
              {
                id: "rescheduleJob",
                params: [t["string?"](), t["number?"](), t["number?"](), t.string(), idDataType],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [
          scheduledAtIso,
          scheduleAfterMsOrNull,
          scheduleAfterMsOrNull,
          JSON.stringify(error),
          jobId,
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
UPDATE {{table_prefix}}job
SET status = 'completed',
  completed_at = datetime('now', 'subsec'),
  completed_by = ?,
  output = ?,
  leased_by = NULL,
  leased_until = NULL,
  last_attempt_error = NULL
WHERE id = ?
RETURNING *
`,
              {
                id: "completeJob",
                params: [t["string?"](), t["string?"](), idDataType],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [workerId, output !== undefined ? JSON.stringify(output) : null, jobId],
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
UPDATE {{table_prefix}}job
SET leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = (
  SELECT id
  FROM {{table_prefix}}job INDEXED BY {{table_prefix}}job_expired_lease_idx
  WHERE leased_until IS NOT NULL
    AND leased_until <= datetime('now', 'subsec')
    AND status = 'running'
    AND type_name IN (SELECT value FROM json_each(?))
    AND id NOT IN (SELECT value FROM json_each(?))
  ORDER BY leased_until ASC
  LIMIT 1
)
RETURNING *
`,
              {
                id: "reapExpiredJobLease",
                params: [t.string(), t.string()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [JSON.stringify(typeNames), JSON.stringify(ignoredJobIds ?? [])],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    deleteChains: async ({ txCtx, chainIds, cascade }) => {
      const effectiveChainIds = cascade ? await expandChainIds(txCtx, chainIds) : chainIds;
      if (effectiveChainIds.length === 0) return { deleted: [], blockerRefs: [] };

      const blockerRefs = await getExternalBlockerRefs(txCtx, effectiveChainIds);
      if (blockerRefs.length > 0) return { deleted: [], blockerRefs };

      const chainIdsJson = JSON.stringify(effectiveChainIds);
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getChainsByChainIds", () =>
          applyTemplate(
            sql(
              `
SELECT
  {{job_columns:j}},
  {{job_columns_prefixed:lc:lc_}}
FROM {{table_prefix}}job AS j
LEFT JOIN {{table_prefix}}job AS lc
  ON lc.chain_id = j.id
  AND lc.chain_index = (
    SELECT MAX(chain_index) FROM {{table_prefix}}job
    WHERE chain_id = j.id
  )
WHERE j.id = j.chain_id
  AND j.chain_id IN (SELECT value FROM json_each(?))
`,
              {
                id: "getChainsByChainIds",
                params: [t.string()],
                columns: { ...dbChainRowColumns },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [chainIdsJson],
      });
      await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("deleteBlockersByChainIds", () =>
          applyTemplate(
            sql(
              `
DELETE FROM {{table_prefix}}job_blocker
WHERE job_id IN (
  SELECT id FROM {{table_prefix}}job WHERE chain_id IN (SELECT value FROM json_each(?))
)
`,
              {
                id: "deleteBlockersByChainIds",
                params: [t.string()],
                columns: {},
              },
            ),
          ),
        ),
        params: [chainIdsJson],
      });
      await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("deleteChains", () =>
          applyTemplate(
            sql(
              `
DELETE FROM {{table_prefix}}job
WHERE chain_id IN (SELECT value FROM json_each(?))
`,
              {
                id: "deleteChains",
                params: [t.string()],
                columns: {},
              },
            ),
          ),
        ),
        params: [chainIdsJson],
      });
      const deleted = rows.map((row) => {
        const { rootJob, lastChainJob } = parseDbChainRow(row);
        return [
          mapDbJobToStateJob(rootJob),
          lastChainJob && lastChainJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastChainJob)
            : undefined,
        ] as [StateJob, StateJob | undefined];
      });
      return { deleted, blockerRefs: [] };
    },
    listChains: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
      const conditions: string[] = ["j.chain_index = 0"];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];

      if (filter?.typeName?.length) {
        conditions.push("j.type_name IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.typeName));
        paramTypes.push(t.string());
      }
      if (filter?.rootOnly) {
        conditions.push(
          `NOT EXISTS (SELECT 1 FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = j.chain_id)`,
        );
      }
      if (filter?.chainId?.length) {
        conditions.push("j.chain_id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.chainId));
        paramTypes.push(t.string());
      }
      if (filter?.jobId?.length) {
        conditions.push(
          `j.chain_id IN (SELECT chain_id FROM ${tablePrefix}job WHERE id IN (SELECT value FROM json_each(?)))`,
        );
        params.push(JSON.stringify(filter.jobId));
        paramTypes.push(t.string());
      }
      if (filter?.status?.length) {
        conditions.push("lc.status IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.status));
        paramTypes.push(t.string());
      }
      if (filter?.from) {
        conditions.push("j.created_at >= ?");
        params.push(isoToSqlite(filter.from.toISOString()));
        paramTypes.push(t.string());
      }
      if (filter?.to) {
        conditions.push("j.created_at <= ?");
        params.push(isoToSqlite(filter.to.toISOString()));
        paramTypes.push(t.string());
      }
      if (cursor) {
        const cursorCreatedAt = isoToSqlite(cursor.createdAt);
        if (orderDirection === "desc") {
          conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        } else {
          conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
        }
        params.push(cursorCreatedAt, cursorCreatedAt, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";
      const sqlStr = `SELECT ${jobColumnsSelect("j")}, ${jobColumnsPrefixedSelect("lc", "lc_")} FROM ${tablePrefix}job AS j LEFT JOIN ${tablePrefix}job AS lc ON lc.chain_id = j.id AND lc.rowid = (SELECT lj.rowid FROM ${tablePrefix}job lj WHERE lj.chain_id = j.id ORDER BY lj.chain_index DESC LIMIT 1) WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?`;

      const rows = await executeTypedSql({
        txCtx,
        sql: applyTemplate(
          sql(sqlStr, {
            params: paramTypes,
            columns: dbChainRowColumns,
            readOnly: true,
          }),
        ),
        params,
      });

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;

      const items: [StateJob, StateJob | undefined][] = pageRows.map((row) => {
        const { rootJob, lastChainJob } = parseDbChainRow(row);
        return [
          mapDbJobToStateJob(rootJob),
          lastChainJob && lastChainJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastChainJob)
            : undefined,
        ];
      });

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        const { rootJob } = parseDbChainRow(lastRow);
        nextCursor = encodeCursor({
          type: "createdAt",
          id: rootJob.id,
          createdAt: new Date(rootJob.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },

    listJobs: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
      const conditions: string[] = [];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];

      if (filter?.status?.length) {
        conditions.push("j.status IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.status));
        paramTypes.push(t.string());
      }
      if (filter?.typeName?.length) {
        conditions.push("j.type_name IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.typeName));
        paramTypes.push(t.string());
      }
      if (filter?.chainTypeName?.length) {
        conditions.push("j.chain_type_name IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.chainTypeName));
        paramTypes.push(t.string());
      }
      if (filter?.chainId?.length) {
        conditions.push("j.chain_id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.chainId));
        paramTypes.push(t.string());
      }
      if (filter?.jobId?.length) {
        conditions.push("j.id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.jobId));
        paramTypes.push(t.string());
      }
      if (filter?.from) {
        conditions.push("j.created_at >= ?");
        params.push(isoToSqlite(filter.from.toISOString()));
        paramTypes.push(t.string());
      }
      if (filter?.to) {
        conditions.push("j.created_at <= ?");
        params.push(isoToSqlite(filter.to.toISOString()));
        paramTypes.push(t.string());
      }
      if (cursor) {
        const cursorCreatedAt = isoToSqlite(cursor.createdAt);
        if (orderDirection === "desc") {
          conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        } else {
          conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
        }
        params.push(cursorCreatedAt, cursorCreatedAt, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sqlStr = `SELECT * FROM ${tablePrefix}job j ${where} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?`;

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
          createdAt: new Date(lastRow.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeChainIndexCursor(page.cursor) : null;
      const conditions: string[] = ["j.chain_id = ?"];
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [idDataType];

      if (cursor) {
        if (orderDirection === "asc") {
          conditions.push("(j.chain_index > ? OR (j.chain_index = ? AND j.id > ?))");
        } else {
          conditions.push("(j.chain_index < ? OR (j.chain_index = ? AND j.id < ?))");
        }
        params.push(cursor.chainIndex, cursor.chainIndex, cursor.id);
        paramTypes.push(t.number(), t.number(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const orderDir = orderDirection === "asc" ? "ASC" : "DESC";
      const sqlStr = `SELECT * FROM ${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.chain_index ${orderDir}, j.id ${orderDir} LIMIT ?`;

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
UPDATE {{table_prefix}}job
SET scheduled_at = datetime('now', 'subsec')
WHERE id IN (SELECT value FROM json_each(?))
  AND status = 'pending'
RETURNING *
`,
              {
                id: "triggerJobs",
                params: [t.string()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [JSON.stringify(jobIds)],
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
        `j.id IN (SELECT jb.job_id FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = ?)`,
      ];
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [idDataType];

      if (cursor) {
        const cursorCreatedAt = isoToSqlite(cursor.createdAt);
        if (orderDirection === "desc") {
          conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        } else {
          conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
        }
        params.push(cursorCreatedAt, cursorCreatedAt, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";
      const sqlStr = `SELECT * FROM ${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?`;

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
          createdAt: new Date(lastRow.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },
    migrateToLatest: async () => {
      if (checkForeignKeys) {
        await stateProvider.withTransaction(async (txCtx) => {
          const [fkResult] = await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql("PRAGMA foreign_keys", {
                params: [],
                columns: { foreign_keys: t.number() },
                readOnly: true,
              }),
            ),
          });
          if (!fkResult || fkResult.foreign_keys !== 1) {
            throw new Error(
              "SQLite foreign_keys pragma is not enabled. " +
                "Enable it with PRAGMA foreign_keys = ON before using the adapter. " +
                "Foreign key enforcement is required for blocker relationship integrity.",
            );
          }
        });
      }

      if (checkAutoVacuum) {
        const [avResult] = await executeTypedSql({
          sql: applyTemplate(
            sql("PRAGMA auto_vacuum", {
              params: [],
              columns: { auto_vacuum: t.number() },
              readOnly: true,
            }),
          ),
        });
        if (!avResult || avResult.auto_vacuum !== 2) {
          throw new Error(
            "SQLite auto_vacuum pragma is not set to INCREMENTAL. " +
              "Enable it with PRAGMA auto_vacuum = INCREMENTAL before creating tables. " +
              "Incremental auto-vacuum is required for vacuum() to reclaim disk space.",
          );
        }
      }

      return executeMigrations<TTxContext>({
        migrations,
        runInTransaction: stateProvider.withTransaction,
        getAppliedMigrationNames: async (txCtx) => {
          await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(
                `
CREATE TABLE IF NOT EXISTS {{table_prefix}}migration (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
)`,
                {
                  id: "createMigrationTable",
                  params: [],
                  columns: {},
                },
              ),
            ),
          });
          const applied = await executeTypedSql({
            txCtx,
            sql: applyTemplate(
              sql(`SELECT name, applied_at FROM {{table_prefix}}migration ORDER BY name`, {
                id: "getAppliedMigrations",
                params: [],
                columns: { name: t.string(), applied_at: t.string() },
                readOnly: true,
              }),
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
                `INSERT INTO {{table_prefix}}migration (name) VALUES (?) ON CONFLICT (name) DO NOTHING`,
                {
                  id: "recordMigration",
                  params: [t.string()],
                  columns: {},
                },
              ),
            ),
            params: [name],
          });
        },
      });
    },
    vacuum: async () => {
      await executeTypedSql({
        sql: applyTemplate(sql("PRAGMA incremental_vacuum", { params: [], columns: {} })),
      });
    },
    truncate: async () => {
      await executeTypedSql({
        sql: applyTemplate(
          sql(`DELETE FROM ${tablePrefix}job_blocker`, { params: [], columns: {} }),
        ),
      });
      await executeTypedSql({
        sql: applyTemplate(sql(`DELETE FROM ${tablePrefix}job`, { params: [], columns: {} })),
      });
    },
  };
};

/**
 * SQLite state adapter type. Includes `migrateToLatest` for schema migrations, `vacuum` for reclaiming disk space, and `truncate` for clearing all job data.
 * @experimental
 */
export type SqliteStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
> = StateAdapter<TTxContext, TJobId> & {
  migrateToLatest: () => Promise<MigrationResult>;
  vacuum: () => Promise<void>;
  truncate: () => Promise<void>;
};
