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

import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

const jobColumns = [
  "id",
  "type_name",
  "chain_id",
  "chain_type_name",
  "chain_index",
  "continued_to_id",
  "input",
  "output",
  "blocked",
  "created_at",
  "scheduled_at",
  "completed_at",
  "completed_by",
  "attempt",
  "last_attempt_at",
  "last_attempt_error",
  "attempt_at",
  "attempt_by",
  "attempt_until",
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
  continued_to_id: string | null;
  input: string | null;
  output: string | null;

  blocked: number;
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

type DbChainRow = DbJob & {
  [K in keyof DbJob as `lc_${K}`]: DbJob[K] | null;
};

/** @internal */
export const migrations: Migration[] = [
  {
    name: "20240101000000_initial_schema",
    type: "transactional",
    statements: [
      sql(/* sql */ `
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
      sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}job_blocker (
  job_id                        {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  -- NOTE: requires PRAGMA foreign_keys = ON (SQLite default is OFF)
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  "index"                       INTEGER NOT NULL,
  trace_context                 TEXT,
  PRIMARY KEY (job_id, blocked_by_chain_id)
)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_acquisition_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}job_chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_expired_lease_idx
ON {{table_prefix}}job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_idx
ON {{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_idx
ON {{table_prefix}}job (created_at DESC)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_status_idx
ON {{table_prefix}}job (status, created_at DESC)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_type_name_idx
ON {{table_prefix}}job (type_name, created_at DESC)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_type_name_idx
ON {{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`),
    ],
  },
  {
    name: "20260430000000_rename_chain_indexes",
    type: "transactional",
    statements: [
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_chain_index_idx`),
      sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_chain_listing_idx`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_listing_idx
ON {{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_chain_listing_type_name_idx`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_listing_type_name_idx
ON {{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`),
    ],
  },
  {
    name: "20260617000000_blocker_composite_pk",
    type: "transactional",
    statements: [
      sql(`
CREATE TABLE {{table_prefix}}job_blocker_new (
  job_id                        {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  "index"                       INTEGER NOT NULL,
  trace_context                 TEXT,
  PRIMARY KEY (job_id, blocked_by_chain_id, "index")
)`),
      sql(`
INSERT INTO {{table_prefix}}job_blocker_new (job_id, blocked_by_chain_id, "index", trace_context)
SELECT job_id, blocked_by_chain_id, "index", trace_context FROM {{table_prefix}}job_blocker`),
      sql(`DROP TABLE {{table_prefix}}job_blocker`),
      sql(`ALTER TABLE {{table_prefix}}job_blocker_new RENAME TO {{table_prefix}}job_blocker`),
      sql(`
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`),
    ],
  },
  {
    name: "20260622000000_job_model_v2",
    type: "transactional",
    statements: [
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job
  ADD COLUMN continued_to_id {{id_type}} REFERENCES {{table_prefix}}job(id)`),
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job
  ADD COLUMN leased_at TEXT`),
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job
  ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0`),
      sql(/* sql */ `
UPDATE {{table_prefix}}job AS j
SET continued_to_id = (
  SELECT n.id FROM {{table_prefix}}job n
  WHERE n.chain_id = j.chain_id AND n.chain_index = j.chain_index + 1
)
WHERE j.continued_to_id IS NULL
  AND EXISTS (
    SELECT 1 FROM {{table_prefix}}job n
    WHERE n.chain_id = j.chain_id AND n.chain_index = j.chain_index + 1
  )`),
      sql(/* sql */ `
UPDATE {{table_prefix}}job
SET blocked = 1, status = 'pending'
WHERE status = 'blocked'`),
      sql(/* sql */ `
UPDATE {{table_prefix}}job
SET leased_at = COALESCE(leased_until, datetime('now', 'subsec')),
  leased_by = COALESCE(leased_by, 'migrated')
WHERE status = 'running' AND (leased_at IS NULL OR leased_by IS NULL)`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_acquisition_idx`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_expired_lease_idx`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_listing_status_idx`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_listing_type_name_idx`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}chain_listing_type_name_idx`),
      sql(/* sql */ `ALTER TABLE {{table_prefix}}job DROP COLUMN status`),
      sql(/* sql */ `ALTER TABLE {{table_prefix}}job RENAME COLUMN leased_at TO attempt_at`),
      sql(/* sql */ `ALTER TABLE {{table_prefix}}job RENAME COLUMN leased_by TO attempt_by`),
      sql(/* sql */ `ALTER TABLE {{table_prefix}}job RENAME COLUMN leased_until TO attempt_until`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_ready_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE blocked = 0 AND attempt_at IS NULL AND completed_at IS NULL`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_pending_idx
ON {{table_prefix}}job (scheduled_at)
WHERE attempt_at IS NULL AND completed_at IS NULL`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_running_idx
ON {{table_prefix}}job (type_name, attempt_until)
WHERE attempt_at IS NOT NULL AND completed_at IS NULL`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_completed_idx
ON {{table_prefix}}job (completed_at)
WHERE completed_at IS NOT NULL`),
      sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}job_continuation_idx
ON {{table_prefix}}job (continued_to_id)
WHERE continued_to_id IS NOT NULL`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_tail_open_idx
ON {{table_prefix}}job (chain_id)
WHERE continued_to_id IS NULL AND completed_at IS NULL`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_tail_completed_idx
ON {{table_prefix}}job (chain_id)
WHERE continued_to_id IS NULL AND completed_at IS NOT NULL`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}chain_listing_idx`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_head_idx
ON {{table_prefix}}job (created_at) WHERE chain_index = 0`),
      sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_listing_idx`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_idx
ON {{table_prefix}}job (created_at)`),
    ],
  },
];

/** @internal */
export const createMigrationStore = <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext>,
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
CREATE TABLE IF NOT EXISTS {{table_prefix}}migration (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
)`,
      { id: "createMigrationTable", params: [], columns: {} },
    ),
  );
  const getAppliedMigrationsSql = applyTemplate(
    sql(/* sql */ `SELECT name FROM {{table_prefix}}migration ORDER BY name`, {
      id: "getAppliedMigrations",
      params: [],
      columns: { name: t.string() },
      readOnly: true,
    }),
  );
  const recordMigrationSql = applyTemplate(
    sql(
      /* sql */ `INSERT INTO {{table_prefix}}migration (name) VALUES (?) ON CONFLICT (name) DO NOTHING`,
      {
        id: "recordMigration",
        params: [t.string()],
        columns: {},
      },
    ),
  );

  return {
    initialize: async () => {
      await exec({ sql: createMigrationTableSql });
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
        sql(/* sql */ `${applied.sql} RETURNING 1 AS affected`, {
          id: applied.id != null ? `batch:${applied.id}` : undefined,
          params: [],
          columns: { affected: t.number() },
        }),
      );
      const rows = await exec({ txCtx, sql: wrapped });
      return rows.length;
    },
    recordMigration: async (txCtx, name) => {
      await exec({ txCtx, sql: recordMigrationSql, params: [name] });
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
    continuedToId: dbJob.continued_to_id,
    input: parseJson(dbJob.input),
    output: parseJson(dbJob.output),

    blocked: dbJob.blocked === 1,
    createdAt: new Date(dbJob.created_at + "Z"),
    scheduledAt: new Date(dbJob.scheduled_at + "Z"),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at + "Z") : null,
    completedBy: dbJob.completed_by,

    attempt: dbJob.attempt,
    lastAttemptError: parseJson(dbJob.last_attempt_error) as string | null,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at + "Z") : null,

    attemptAt: dbJob.attempt_at ? new Date(dbJob.attempt_at + "Z") : null,
    attemptBy: dbJob.attempt_by,
    attemptUntil: dbJob.attempt_until ? new Date(dbJob.attempt_until + "Z") : null,

    deduplicationKey: dbJob.deduplication_key,

    chainTraceContext: dbJob.chain_trace_context,
    traceContext: dbJob.trace_context,
  };
};

const parseDbChainRow = (row: DbChainRow): { headJob: DbJob; tailJob: DbJob | null } => {
  const headJob: DbJob = {
    id: row.id,
    type_name: row.type_name,
    chain_id: row.chain_id,
    chain_type_name: row.chain_type_name,
    chain_index: row.chain_index,
    continued_to_id: row.continued_to_id,
    input: row.input,
    output: row.output,
    blocked: row.blocked,
    created_at: row.created_at,
    scheduled_at: row.scheduled_at,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
    attempt: row.attempt,
    last_attempt_at: row.last_attempt_at,
    last_attempt_error: row.last_attempt_error,
    attempt_at: row.attempt_at,
    attempt_by: row.attempt_by,
    attempt_until: row.attempt_until,
    deduplication_key: row.deduplication_key,
    chain_trace_context: row.chain_trace_context,
    trace_context: row.trace_context,
  };

  const tailJob: DbJob | null = row.lc_id
    ? {
        id: row.lc_id,
        type_name: row.lc_type_name!,
        chain_id: row.lc_chain_id!,
        chain_type_name: row.lc_chain_type_name!,
        chain_index: row.lc_chain_index!,
        continued_to_id: row.lc_continued_to_id,
        input: row.lc_input,
        output: row.lc_output,
        blocked: row.lc_blocked!,
        created_at: row.lc_created_at!,
        scheduled_at: row.lc_scheduled_at!,
        completed_at: row.lc_completed_at,
        completed_by: row.lc_completed_by,
        attempt: row.lc_attempt!,
        last_attempt_at: row.lc_last_attempt_at,
        last_attempt_error: row.lc_last_attempt_error,
        attempt_at: row.lc_attempt_at,
        attempt_by: row.lc_attempt_by,
        attempt_until: row.lc_attempt_until,
        deduplication_key: row.lc_deduplication_key,
        chain_trace_context: row.lc_chain_trace_context,
        trace_context: row.lc_trace_context,
      }
    : null;

  return { headJob, tailJob };
};

/**
 * Create a state adapter backed by SQLite. Returns the adapter with a `migrateToLatest()` method for schema migrations.
 *
 * @param options - SQLite state adapter configuration.
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
  /**
   * Predicate returning `true` if the ID is acceptable. Runs on both generated
   * and caller-supplied IDs; failures throw `InvalidJobIdError`.
   */
  validateId?: (id: TIdType) => boolean;
  /**
   * Whether `migrateToLatest()` verifies that `PRAGMA foreign_keys = ON` is set.
   * Disable only if foreign keys are managed externally.
   *
   * @defaultValue `true`
   */
  checkForeignKeys?: boolean;
  /**
   * Whether `migrateToLatest()` verifies that `PRAGMA auto_vacuum = INCREMENTAL`
   * is set. Required for `vacuum()` to reclaim disk space.
   *
   * @defaultValue `true`
   */
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

  let closed = false;

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
    continued_to_id: t["string?"](),
    input: t["string?"](),
    output: t["string?"](),
    blocked: t.number(),
    created_at: t.string(),
    scheduled_at: t.string(),
    completed_at: t["string?"](),
    completed_by: t["string?"](),
    attempt: t.number(),
    last_attempt_error: t["string?"](),
    last_attempt_at: t["string?"](),
    attempt_at: t["string?"](),
    attempt_by: t["string?"](),
    attempt_until: t["string?"](),
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
    lc_continued_to_id: t["string?"](),
    lc_input: t["string?"](),
    lc_output: t["string?"](),
    lc_blocked: t["number?"](),
    lc_created_at: t["string?"](),
    lc_scheduled_at: t["string?"](),
    lc_completed_at: t["string?"](),
    lc_completed_by: t["string?"](),
    lc_attempt: t["number?"](),
    lc_last_attempt_error: t["string?"](),
    lc_last_attempt_at: t["string?"](),
    lc_attempt_at: t["string?"](),
    lc_attempt_by: t["string?"](),
    lc_attempt_until: t["string?"](),
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
      const byId = new Map<string, { headJob: DbJob; tailJob: DbJob | null }>();
      for (const row of rows) {
        const parsed = parseDbChainRow(row);
        byId.set(parsed.headJob.id, parsed);
      }
      return chainIds.map((chainId): [StateJob, StateJob | undefined] | undefined => {
        const parsed = byId.get(chainId as string);
        if (!parsed) return undefined;
        const { headJob, tailJob } = parsed;
        return [
          mapDbJobToStateJob(headJob),
          tailJob && tailJob.id !== headJob.id ? mapDbJobToStateJob(tailJob) : undefined,
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

    createChains: async ({ txCtx, jobs }) => {
      for (const job of jobs) {
        if (job.id !== undefined) validateId(job.id, "caller");
      }
      const results: { job: StateJob; deduplicated: boolean }[] = Array.from({
        length: jobs.length,
      });
      const toInsert: {
        index: number;
        id: string;
        json: Record<string, unknown>;
      }[] = [];
      const intraBatchDedup = new Map<string, number>();
      const deferredDupes: { index: number; firstIndex: number }[] = [];

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const { typeName, id: providedId, input, schedule, chainTraceContext, traceContext } = job;

        if (job.deduplication?.key) {
          const deduplicationKey = job.deduplication.key;
          const deduplicationScope = job.deduplication.scope;
          const deduplicationWindowMs = job.deduplication.windowMs ?? null;
          const deduplicationExcludeChainIds = job.deduplication.excludeChainIds
            ? JSON.stringify(job.deduplication.excludeChainIds)
            : null;

          const batchKey = `${deduplicationKey}\0${job.chainTypeName}`;
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
    OR (? = 'running' AND NOT EXISTS (
      SELECT 1 FROM {{table_prefix}}job j2
      WHERE j2.chain_id = {{table_prefix}}job.id AND j2.completed_at IS NOT NULL AND j2.continued_to_id IS NULL
    ))
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
              job.chainTypeName,
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
            chain_type_name: job.chainTypeName,
            input: input !== undefined ? JSON.stringify(input) : null,
            deduplication_key: job.deduplication?.key ?? null,
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
          sql: templateCache.getOrCompute("insertChains", () =>
            applyTemplate(
              sql(
                `
WITH input_data AS (
  SELECT
    je.key                                              AS ord,
    json_extract(je.value, '$.id')                      AS new_id,
    json_extract(je.value, '$.type_name')               AS type_name,
    json_extract(je.value, '$.chain_type_name')         AS chain_type_name,
    json_extract(je.value, '$.input')                   AS input,
    json_extract(je.value, '$.deduplication_key')       AS deduplication_key,
    json_extract(je.value, '$.scheduled_at')            AS sched_at,
    json_extract(je.value, '$.schedule_after_ms')       AS sched_after_ms,
    json_extract(je.value, '$.chain_trace_context')     AS chain_trace_context,
    json_extract(je.value, '$.trace_context')           AS trace_context
  FROM json_each(?) AS je
)
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_type_name, chain_index, input, deduplication_key, scheduled_at, chain_trace_context, trace_context)
SELECT
  d.new_id,
  d.type_name,
  d.new_id,
  d.chain_type_name,
  0,
  d.input,
  d.deduplication_key,
  MAX(
    COALESCE(
      d.sched_at,
      CASE WHEN d.sched_after_ms IS NOT NULL
        THEN datetime('now', 'subsec', '+' || (d.sched_after_ms / 1000.0) || ' seconds')
        ELSE NULL
      END,
      datetime('now', 'subsec')
    ),
    datetime('now', 'subsec')
  ),
  d.chain_trace_context,
  d.trace_context
FROM input_data d
ORDER BY d.ord
ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = {{table_prefix}}job.id
RETURNING *
`,
                {
                  id: "insertChains",
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

    createContinuationJob: async ({ txCtx, job }) => {
      if (job.id !== undefined) validateId(job.id, "caller");
      const newId = job.id ?? generateId();
      const { typeName, input, schedule, chainTraceContext, traceContext, continueFromId } = job;

      const [row] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("insertContinuation", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT
    ?               AS new_id,
    ?               AS type_name,
    ?               AS input,
    ?               AS sched_at,
    ?               AS sched_after_ms,
    ?               AS chain_trace_context,
    ?               AS trace_context,
    p.chain_id      AS parent_chain_id,
    p.chain_type_name AS parent_chain_type_name,
    p.chain_index   AS parent_chain_index
  FROM {{table_prefix}}job p
  WHERE p.id = ?
)
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_type_name, chain_index, input, scheduled_at, chain_trace_context, trace_context)
SELECT
  d.new_id,
  d.type_name,
  d.parent_chain_id,
  d.parent_chain_type_name,
  d.parent_chain_index + 1,
  d.input,
  MAX(
    COALESCE(
      d.sched_at,
      CASE WHEN d.sched_after_ms IS NOT NULL
        THEN datetime('now', 'subsec', '+' || (d.sched_after_ms / 1000.0) || ' seconds')
        ELSE NULL
      END,
      datetime('now', 'subsec')
    ),
    datetime('now', 'subsec')
  ),
  d.chain_trace_context,
  d.trace_context
FROM input_data d
WHERE true
ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = {{table_prefix}}job.id
RETURNING *
`,
              {
                id: "insertContinuation",
                params: [
                  idDataType,
                  t.string(),
                  t["string?"](),
                  t["string?"](),
                  t["number?"](),
                  t["string?"](),
                  t["string?"](),
                  idDataType,
                ],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [
          newId,
          typeName,
          input !== undefined ? JSON.stringify(input) : null,
          schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null,
          schedule?.afterMs ?? null,
          chainTraceContext ?? null,
          traceContext ?? null,
          continueFromId,
        ],
      });

      if (!row) {
        throw new Error(`continueWith parent job ${continueFromId} not found`);
      }

      return { job: mapDbJobToStateJob(row), deduplicated: row.id !== newId };
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
  EXISTS (
    SELECT 1 FROM {{table_prefix}}job j2
    WHERE j2.chain_id = jb.blocked_by_chain_id
      AND j2.continued_to_id IS NULL AND j2.completed_at IS NOT NULL
  ) AS blocker_complete
FROM {{table_prefix}}job_blocker jb
WHERE jb.job_id = ?
`,
                {
                  id: "checkBlockersStatus",
                  params: [idDataType],
                  columns: {
                    job_id: idDataType,
                    blocked_by_chain_id: idDataType,
                    blocker_complete: t["number?"](),
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
          .filter((b) => b.blocker_complete !== 1)
          .map((b) => b.blocked_by_chain_id);

        if (incompleteBlockerChainIds.length > 0) {
          const [updatedJob] = await executeTypedSql({
            txCtx,
            sql: templateCache.getOrCompute("updateJobToBlocked", () =>
              applyTemplate(
                sql(
                  `
UPDATE {{table_prefix}}job
SET blocked = 1
WHERE id = ? AND completed_at IS NULL AND attempt_at IS NULL AND blocked = 0
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
              sql(/* sql */ `SELECT * FROM {{table_prefix}}job WHERE id = ?`, {
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
        const { headJob, tailJob } = parseDbChainRow(row);
        return [
          mapDbJobToStateJob(headJob),
          tailJob && tailJob.id !== headJob.id ? mapDbJobToStateJob(tailJob) : undefined,
        ];
      });
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
    EXISTS (
      SELECT 1 FROM {{table_prefix}}job j2
      WHERE j2.chain_id = jb.blocked_by_chain_id
        AND j2.continued_to_id IS NULL AND j2.completed_at IS NOT NULL
    ) AS blocker_complete
  FROM {{table_prefix}}job_blocker jb
  WHERE jb.job_id IN (SELECT job_id FROM direct_blocked)
)
SELECT job_id
FROM blockers_status
GROUP BY job_id
HAVING MIN(CASE WHEN blocker_complete = 1 THEN 1 ELSE 0 END) = 1
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
  blocked = 0
WHERE id IN (SELECT value FROM json_each(?)) AND blocked = 1
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
    startJobAttempt: async ({ txCtx, typeNames, workerId }) => {
      const typeNamesJson = JSON.stringify(typeNames);
      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("startJobAttempt", () =>
          applyTemplate(
            sql(
              `
UPDATE {{table_prefix}}job
SET attempt = attempt + 1,
  attempt_at = datetime('now', 'subsec'),
  attempt_by = ?
WHERE id = (
  SELECT id
  FROM {{table_prefix}}job INDEXED BY {{table_prefix}}job_ready_idx
  WHERE type_name IN (SELECT value FROM json_each(?))
    AND blocked = 0
    AND attempt_at IS NULL
    AND completed_at IS NULL
    AND scheduled_at <= datetime('now', 'subsec')
  ORDER BY scheduled_at ASC
  LIMIT 1
)
RETURNING *
`,
              {
                id: "startJobAttempt",
                params: [t.string(), t.string()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [workerId, typeNamesJson],
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
UPDATE {{table_prefix}}job
SET attempt_until = datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds')
WHERE id = ?
  AND attempt_by = ?
RETURNING *
`,
              {
                id: "extendJobAttempt",
                params: [t.number(), idDataType, t.string()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [timeoutMs, jobId, workerId],
      });

      return mapDbJobToStateJob(job);
    },
    finishJobAttempt: async ({ txCtx, jobId, workerId, outcome }) => {
      if (outcome.error !== undefined) {
        const scheduledAtIso =
          outcome.schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
        const scheduleAfterMsOrNull = outcome.schedule?.afterMs ?? null;
        const [job] = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("finishJobAttemptFailed", () =>
            applyTemplate(
              sql(
                `
UPDATE {{table_prefix}}job
SET last_attempt_at = datetime('now', 'subsec'),
  last_attempt_error = ?,
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL,
  scheduled_at = MAX(
    COALESCE(?,
      CASE WHEN ? IS NOT NULL THEN datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds') ELSE NULL END,
      datetime('now', 'subsec')),
    datetime('now', 'subsec'))
WHERE id = ?
  AND attempt_by = ?
RETURNING *
`,
                {
                  id: "finishJobAttemptFailed",
                  params: [
                    t.string(),
                    t["string?"](),
                    t["number?"](),
                    t["number?"](),
                    idDataType,
                    t["string?"](),
                  ],
                  columns: { ...dbJobColumns },
                },
              ),
            ),
          ),
          params: [
            JSON.stringify(outcome.error),
            scheduledAtIso,
            scheduleAfterMsOrNull,
            scheduleAfterMsOrNull,
            jobId,
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
UPDATE {{table_prefix}}job
SET completed_at = datetime('now', 'subsec'),
  completed_by = ?,
  output = ?,
  continued_to_id = ?,
  blocked = 0,
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL,
  last_attempt_error = NULL
WHERE id = ?
  AND completed_at IS NULL
RETURNING *
`,
              {
                id: "finishJobAttemptCompleted",
                params: [t["string?"](), t["string?"](), t["string?"](), idDataType],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [
          workerId,
          outcome.continuedToId != null || outcome.output === undefined
            ? null
            : JSON.stringify(outcome.output),
          outcome.continuedToId ?? null,
          jobId,
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
UPDATE {{table_prefix}}job
SET attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL
WHERE id = (
  SELECT id
  FROM {{table_prefix}}job INDEXED BY {{table_prefix}}job_running_idx
  WHERE attempt_at IS NOT NULL
    AND attempt_until IS NOT NULL
    AND attempt_until <= datetime('now', 'subsec')
    AND completed_at IS NULL
    AND type_name IN (SELECT value FROM json_each(?))
    AND id NOT IN (SELECT value FROM json_each(?))
  ORDER BY attempt_until ASC
  LIMIT 1
)
RETURNING *
`,
              {
                id: "reclaimExpiredJobAttempt",
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
    getStartAttemptDelayMs: async ({ txCtx, typeNames }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getStartAttemptDelayMs", () =>
          applyTemplate(
            sql(
              `
SELECT
  MAX(0, CAST((julianday(job.scheduled_at) - julianday(datetime('now', 'subsec'))) * 86400000 AS INTEGER)) AS delay_ms
FROM {{table_prefix}}job as job INDEXED BY {{table_prefix}}job_ready_idx
WHERE job.type_name IN (SELECT value FROM json_each(?))
  AND job.blocked = 0
  AND job.attempt_at IS NULL
  AND job.completed_at IS NULL
ORDER BY job.scheduled_at ASC
LIMIT 1
`,
              {
                id: "getStartAttemptDelayMs",
                params: [t.string()],
                columns: { delay_ms: t.number() },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [JSON.stringify(typeNames)],
      });
      return result ? result.delay_ms : null;
    },
    rescheduleJobs: async ({ txCtx, jobIds, schedule }) => {
      if (jobIds.length === 0) return [];
      const scheduledAtIso = schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
      const scheduleAfterMsOrNull = schedule?.afterMs ?? null;
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("rescheduleJobs", () =>
          applyTemplate(
            sql(
              `
UPDATE {{table_prefix}}job
SET scheduled_at = MAX(
    COALESCE(?,
      CASE WHEN ? IS NOT NULL THEN datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds') ELSE NULL END,
      datetime('now', 'subsec')),
    datetime('now', 'subsec'))
WHERE id IN (SELECT value FROM json_each(?))
  AND completed_at IS NULL
  AND attempt_at IS NULL
RETURNING *
`,
              {
                id: "rescheduleJobs",
                params: [t["string?"](), t["number?"](), t["number?"](), t.string()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [
          scheduledAtIso,
          scheduleAfterMsOrNull,
          scheduleAfterMsOrNull,
          JSON.stringify(jobIds),
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
        const { headJob, tailJob } = parseDbChainRow(row);
        return [
          mapDbJobToStateJob(headJob),
          tailJob && tailJob.id !== headJob.id ? mapDbJobToStateJob(tailJob) : undefined,
        ] as [StateJob, StateJob | undefined];
      });
      return { deleted, blockerRefs: [] };
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
      const sortKey = orderBy;
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, sortKey) : null;
      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";

      const conditions: string[] = [];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];

      const addFilter = () => {
        if (typeName?.length) {
          conditions.push("root.type_name IN (SELECT value FROM json_each(?))");
          params.push(JSON.stringify(typeName));
          paramTypes.push(t.string());
        }
        if (independent === true) {
          conditions.push(
            `NOT EXISTS (SELECT 1 FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = root.chain_id)`,
          );
        } else if (independent === false) {
          conditions.push(
            `EXISTS (SELECT 1 FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = root.chain_id)`,
          );
        }
        if (chainId?.length) {
          conditions.push("root.chain_id IN (SELECT value FROM json_each(?))");
          params.push(JSON.stringify(chainId));
          paramTypes.push(t.string());
        }
        if (from) {
          conditions.push("root.created_at >= ?");
          params.push(isoToSqlite(from.toISOString()));
          paramTypes.push(t.string());
        }
        if (to) {
          conditions.push("root.created_at <= ?");
          params.push(isoToSqlite(to.toISOString()));
          paramTypes.push(t.string());
        }
      };

      let sqlStr: string;

      if (status === "running" && orderBy === "createdAt") {
        // Drive from tails WHERE continued_to_id IS NULL AND completed_at IS NULL, JOIN to root
        addFilter();
        const sortAlias = "root";
        const sortCol = "created_at";
        if (cursor) {
          const cursorValue = isoToSqlite(cursor.value);
          if (orderDirection === "desc") {
            conditions.push(
              `(${sortAlias}.${sortCol} < ? OR (${sortAlias}.${sortCol} = ? AND ${sortAlias}.id < ?))`,
            );
          } else {
            conditions.push(
              `(${sortAlias}.${sortCol} > ? OR (${sortAlias}.${sortCol} = ? AND ${sortAlias}.id > ?))`,
            );
          }
          params.push(cursorValue, cursorValue, cursor.id);
          paramTypes.push(t.string(), t.string(), t.string());
        }
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
        sqlStr = `SELECT ${jobColumnsSelect("root")}, ${jobColumnsPrefixedSelect("tail", "lc_")} FROM ${tablePrefix}job AS tail JOIN ${tablePrefix}job AS root ON root.chain_id = tail.chain_id AND root.chain_index = 0 WHERE tail.continued_to_id IS NULL AND tail.completed_at IS NULL ${where} ORDER BY root.created_at ${orderDir}, root.id ${orderDir} LIMIT ?`;
      } else if (status === "completed" && orderBy === "completedAt") {
        // Drive from tails WHERE continued_to_id IS NULL AND completed_at IS NOT NULL, JOIN to root, sort by tail.completed_at
        addFilter();
        const sortAlias = "tail";
        const sortCol = "completed_at";
        if (cursor) {
          const cursorValue = isoToSqlite(cursor.value);
          if (orderDirection === "desc") {
            conditions.push(
              `(${sortAlias}.${sortCol} < ? OR (${sortAlias}.${sortCol} = ? AND root.id < ?))`,
            );
          } else {
            conditions.push(
              `(${sortAlias}.${sortCol} > ? OR (${sortAlias}.${sortCol} = ? AND root.id > ?))`,
            );
          }
          params.push(cursorValue, cursorValue, cursor.id);
          paramTypes.push(t.string(), t.string(), t.string());
        }
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
        sqlStr = `SELECT ${jobColumnsSelect("root")}, ${jobColumnsPrefixedSelect("tail", "lc_")} FROM ${tablePrefix}job AS tail JOIN ${tablePrefix}job AS root ON root.chain_id = tail.chain_id AND root.chain_index = 0 WHERE tail.continued_to_id IS NULL AND tail.completed_at IS NOT NULL ${where} ORDER BY tail.completed_at ${orderDir}, root.id ${orderDir} LIMIT ?`;
      } else if (status === "completed" && orderBy === "createdAt") {
        // Drive from heads, LEFT JOIN to tail, filter tail_job.completed_at IS NOT NULL AND tail_job.continued_to_id IS NULL
        conditions.push("j.chain_index = 0");
        addFilter();
        // Remap root alias from "root" to "j" for this branch — addFilter used "root", fix conditions
        for (let i = 0; i < conditions.length; i++) {
          conditions[i] = conditions[i].replace(/\broot\./g, "j.");
        }
        conditions.push("lc.completed_at IS NOT NULL");
        conditions.push("lc.continued_to_id IS NULL");
        if (cursor) {
          const cursorValue = isoToSqlite(cursor.value);
          if (orderDirection === "desc") {
            conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
          } else {
            conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
          }
          params.push(cursorValue, cursorValue, cursor.id);
          paramTypes.push(t.string(), t.string(), t.string());
        }
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        sqlStr = `SELECT ${jobColumnsSelect("j")}, ${jobColumnsPrefixedSelect("lc", "lc_")} FROM ${tablePrefix}job AS j LEFT JOIN ${tablePrefix}job AS lc ON lc.chain_id = j.id AND lc.rowid = (SELECT lj.rowid FROM ${tablePrefix}job lj WHERE lj.chain_id = j.id ORDER BY lj.chain_index DESC LIMIT 1) WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?`;
      } else {
        // Default: no status or status undefined, createdAt order
        // Drive from roots (chain_index = 0), LEFT JOIN to tail
        conditions.push("j.chain_index = 0");
        addFilter();
        for (let i = 0; i < conditions.length; i++) {
          conditions[i] = conditions[i].replace(/\broot\./g, "j.");
        }
        if (cursor) {
          const cursorValue = isoToSqlite(cursor.value);
          if (orderDirection === "desc") {
            conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
          } else {
            conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
          }
          params.push(cursorValue, cursorValue, cursor.id);
          paramTypes.push(t.string(), t.string(), t.string());
        }
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        sqlStr = `SELECT ${jobColumnsSelect("j")}, ${jobColumnsPrefixedSelect("lc", "lc_")} FROM ${tablePrefix}job AS j LEFT JOIN ${tablePrefix}job AS lc ON lc.chain_id = j.id AND lc.rowid = (SELECT lj.rowid FROM ${tablePrefix}job lj WHERE lj.chain_id = j.id ORDER BY lj.chain_index DESC LIMIT 1) WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?`;
      }

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
        const { headJob, tailJob } = parseDbChainRow(row);
        return [
          mapDbJobToStateJob(headJob),
          tailJob && tailJob.id !== headJob.id ? mapDbJobToStateJob(tailJob) : undefined,
        ];
      });

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        const { headJob, tailJob } = parseDbChainRow(lastRow);
        if (status === "completed" && orderBy === "completedAt") {
          const tail = tailJob ?? headJob;
          nextCursor = encodeCursor({
            type: "timestampWithId",
            sortKey: "completedAt",
            value: new Date(tail.completed_at + "Z").toISOString(),
            id: headJob.id,
          });
        } else {
          nextCursor = encodeCursor({
            type: "timestampWithId",
            sortKey: "createdAt",
            value: new Date(headJob.created_at + "Z").toISOString(),
            id: headJob.id,
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
      const status = listJobsParams.status as string | undefined;
      const blocked =
        status === "pending" ? (listJobsParams as { blocked?: boolean }).blocked : undefined;
      const continued =
        status === "completed" ? (listJobsParams as { continued?: boolean }).continued : undefined;

      const sortCol = {
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

      // Status-dependent WHERE clauses
      if (status === "pending") {
        conditions.push("j.attempt_at IS NULL AND j.completed_at IS NULL");
        if (blocked === true) {
          conditions.push("j.blocked = 1");
        } else if (blocked === false) {
          conditions.push("j.blocked = 0");
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
        conditions.push("j.type_name IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(typeName));
        paramTypes.push(t.string());
      }
      if (chainTypeName?.length) {
        conditions.push("j.chain_type_name IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(chainTypeName));
        paramTypes.push(t.string());
      }
      if (chainId?.length) {
        conditions.push("j.chain_id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(chainId));
        paramTypes.push(t.string());
      }
      if (jobId?.length) {
        conditions.push("j.id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(jobId));
        paramTypes.push(t.string());
      }
      if (from) {
        conditions.push("j.created_at >= ?");
        params.push(isoToSqlite(from.toISOString()));
        paramTypes.push(t.string());
      }
      if (to) {
        conditions.push("j.created_at <= ?");
        params.push(isoToSqlite(to.toISOString()));
        paramTypes.push(t.string());
      }
      if (cursor) {
        const cursorValue = isoToSqlite(cursor.value);
        if (orderDirection === "desc") {
          conditions.push(`(j.${sortCol} < ? OR (j.${sortCol} = ? AND j.id < ?))`);
        } else {
          conditions.push(`(j.${sortCol} > ? OR (j.${sortCol} = ? AND j.id > ?))`);
        }
        params.push(cursorValue, cursorValue, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sqlStr = `SELECT * FROM ${tablePrefix}job j ${where} ORDER BY j.${sortCol} ${orderDir}, j.id ${orderDir} LIMIT ?`;

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
        const cursorColValue = lastRow[sortCol as keyof typeof lastRow];
        nextCursor = encodeCursor({
          type: "timestampWithId",
          sortKey: orderBy,
          value: new Date(cursorColValue + "Z").toISOString(),
          id: lastRow.id,
        });
      }

      return { items, nextCursor };
    },

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeIdCursor(page.cursor) : null;
      const orderDir = orderDirection === "asc" ? "ASC" : "DESC";
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [idDataType];
      let sqlStr: string;

      if (cursor) {
        const cmp = orderDirection === "asc" ? ">" : "<";
        params.length = 0;
        params.push(chainId, cursor.id, chainId, page.limit + 1);
        paramTypes.length = 0;
        paramTypes.push(idDataType, idDataType, idDataType, t.number());
        sqlStr = `WITH start_row AS (
          SELECT c.chain_index AS sc
          FROM ${tablePrefix}job c
          WHERE c.chain_id = ? AND c.id = ?
        )
        SELECT j.* FROM ${tablePrefix}job j, start_row s
        WHERE j.chain_id = ?
          AND j.chain_index ${cmp} s.sc
        ORDER BY j.chain_index ${orderDir}, j.id ${orderDir}
        LIMIT ?`;
      } else {
        params.push(page.limit + 1);
        paramTypes.push(t.number());
        sqlStr = `SELECT * FROM ${tablePrefix}job j
        WHERE j.chain_id = ?
        ORDER BY j.chain_index ${orderDir}, j.id ${orderDir}
        LIMIT ?`;
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
        `j.id IN (SELECT jb.job_id FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = ?)`,
      ];
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [idDataType];

      if (cursor) {
        const cursorValue = isoToSqlite(cursor.value);
        if (orderDirection === "desc") {
          conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        } else {
          conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
        }
        params.push(cursorValue, cursorValue, cursor.id);
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
          type: "timestampWithId",
          sortKey: "createdAt",
          value: new Date(lastRow.created_at + "Z").toISOString(),
          id: lastRow.id,
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

      return createMigrator<TTxContext>({
        migrations,
        store: createMigrationStore(stateProvider, applyTemplate),
      }).migrateToLatest();
    },

    vacuum: async () => {
      await executeTypedSql({
        sql: applyTemplate(sql("PRAGMA incremental_vacuum", { params: [], columns: {} })),
      });
    },

    truncate: async () => {
      await stateProvider.withTransaction(async (txCtx) => {
        await executeTypedSql({
          txCtx,
          sql: applyTemplate(
            sql(/* sql */ `DELETE FROM ${tablePrefix}job_blocker`, { params: [], columns: {} }),
          ),
        });
        await executeTypedSql({
          txCtx,
          sql: applyTemplate(
            sql(/* sql */ `DELETE FROM ${tablePrefix}job`, { params: [], columns: {} }),
          ),
        });
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
