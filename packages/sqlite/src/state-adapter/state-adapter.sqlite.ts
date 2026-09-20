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

import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";
import { createLegacyUpgrade } from "./legacy-upgrade.sqlite.js";

const jobColumns = [
  "created_at",
  "scheduled_at",
  "completed_at",
  "last_attempt_at",
  "attempt_at",
  "attempt_until",
  "chain_completed_at",
  "chain_index",
  "attempt",
  "id",
  "chain_id",
  "continued_to_id",
  "status",
  "chain_status",
  "type_name",
  "completed_by",
  "attempt_by",
  "deduplication_key",
  "chain_trace_context",
  "trace_context",
  "last_attempt_error",
  "input",
  "output",
] as const;

const jobColumnsSelect = (alias: string): string =>
  jobColumns.map((c) => `${alias}.${c}`).join(", ");

const jobColumnsPrefixedSelect = (alias: string, prefix: string): string =>
  jobColumns.map((c) => `${alias}.${c} AS ${prefix}${c}`).join(", ");

const chainColumnsSelect = (alias: string): string =>
  [
    `${alias}.type_name AS c_type_name`,
    `${alias}.chain_status AS c_status`,
    `${alias}.created_at AS c_created_at`,
    `${alias}.chain_completed_at AS c_completed_at`,
    `${alias}.deduplication_key AS c_deduplication_key`,
    `${alias}.chain_trace_context AS c_trace_context`,
  ].join(", ");

/**
 * The same columns for a `RETURNING` clause, which SQLite cannot join: each is a
 * correlated primary-key lookup of the row's head row, itself for a head row.
 */
const chainColumnsReturning = (rowRef: string): string =>
  [
    ["type_name", "c_type_name"],
    ["chain_status", "c_status"],
    ["created_at", "c_created_at"],
    ["chain_completed_at", "c_completed_at"],
    ["deduplication_key", "c_deduplication_key"],
    ["chain_trace_context", "c_trace_context"],
  ]
    .map(
      ([column, alias]) =>
        `(SELECT h.${column} FROM {{table_prefix}}job h WHERE h.id = ${rowRef}.chain_id) AS ${alias}`,
    )
    .join(", ");

/**
 * Every row of one chain. Spelled as head-by-primary-key `OR` continuations, because
 * `chain_index_idx` is partial (`WHERE chain_index > 0`) and cannot serve a predicate
 * that does not imply its own — a bare `chain_id = ?` scans the whole job table.
 */
const chainMembers = (alias: string): string =>
  `((${alias}.id = ? AND ${alias}.chain_index = 0) OR (${alias}.chain_id = ? AND ${alias}.chain_index > 0))`;

/**
 * The chain's tail: its last continuation, or nothing at all for a single-job
 * chain. SQLite has no `LATERAL`, so the tail is picked by `MAX(chain_index)`
 * over the partial `chain_index_idx`, which only holds continuations. Both the
 * join and the subquery must spell out `chain_index > 0`: SQLite matches a
 * partial index only when the query's own terms imply its predicate, and without
 * it the join falls back to a full scan of the job table.
 */
const tailJoin = (headAlias: string): string => `
LEFT JOIN {{table_prefix}}job AS tail_job
  ON tail_job.chain_id = ${headAlias}.id
  AND tail_job.chain_index > 0
  AND tail_job.chain_index = (
    SELECT MAX(t.chain_index) FROM {{table_prefix}}job t
    WHERE t.chain_id = ${headAlias}.id AND t.chain_index > 0
  )`;

type DbJob = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_index: number;
  continued_to_id: string | null;

  input: string | null;
  output: string | null;

  status: string;
  created_at: string;
  scheduled_at: string;
  completed_at: string | null;
  completed_by: string | null;

  attempt: number;
  last_attempt_at: string | null;
  last_attempt_error: string | null;

  attempt_at: string | null;
  attempt_by: string | null;
  attempt_until: string | null;

  chain_status: string | null;
  chain_completed_at: string | null;
  deduplication_key: string | null;

  chain_trace_context: string | null;
  trace_context: string | null;
};

/** The chain columns of a head row, joined in alongside a job row. */
type DbChainColumns = {
  c_type_name: string | null;
  c_status: string | null;
  c_created_at: string | null;
  c_completed_at: string | null;
  c_deduplication_key: string | null;
  c_trace_context: string | null;
};

/** A head row with its tail joined in under a `tail_` prefix. */
type DbChainRow = DbJob & {
  [K in keyof DbJob as `tail_${K}`]: DbJob[K] | null;
};

export const migrations: Migration[] = [
  {
    name: "001_initial_schema",
    type: "transactional",
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

  id                            {{id_type}} PRIMARY KEY,
  chain_id                      {{id_type}} NOT NULL,
  continued_to_id               {{id_type}},

  -- TODO!!!: can't change without full table rewrite
  status                        TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  chain_status                  TEXT
                                CHECK (chain_status IN ('running', 'completed')),
  type_name                     TEXT NOT NULL,
  completed_by                  TEXT,
  attempt_by                    TEXT,
  deduplication_key             TEXT,
  chain_trace_context           TEXT,
  trace_context                 TEXT,
  last_attempt_error            TEXT,
  input                         TEXT,
  output                        TEXT
)`),
      sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}job_blocker (
  -- NOTE: requires PRAGMA foreign_keys = ON (SQLite default is OFF). The parent is
  -- always a row the same transaction just inserted; blocked_by_chain_id points at
  -- another chain's head row and carries no reference of its own.
  job_id                        {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  blocked_by_chain_id           {{id_type}} NOT NULL,
  "index"                       INTEGER NOT NULL,
  trace_context                 TEXT,
  PRIMARY KEY (job_id, blocked_by_chain_id, "index")
)`),
      // A head row's (chain_id, 0) is its primary key under another name, so the index
      // holds nothing at all on a single-job workload.
      sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)
WHERE chain_index > 0`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0`),
      // TODO!!!: why not just job_pending_idx?
      // One partial index per job status: acquisition and the pending listing share
      // `job_ready_idx`, the blocked listing has its own so the acquisition index never
      // carries a row it cannot hand out.
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_ready_idx
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
      // Chain listing and counting are head-anchored: every chain fact is on the head row.
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
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_idx
ON {{table_prefix}}job (type_name, created_at)`),
      sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`),
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

const COUNT_CAP = 10000;

// Status filters are spelled as literals, never parameters, so the planner can match
// the status' partial index; the lookup keeps caller input out of the SQL text.
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

const isoToSqlite = (iso: string): string => iso.replace("T", " ").replace("Z", "");

const parseJson = (value: string | null): unknown => {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const sqliteDate = (value: string): Date => new Date(value + "Z");

const mapDbJobToStateJob = (dbJob: DbJob): StateJobInfo => {
  return {
    id: dbJob.id,
    typeName: dbJob.type_name,
    chainId: dbJob.chain_id,
    chainIndex: dbJob.chain_index,
    continuedToId: dbJob.continued_to_id,
    input: parseJson(dbJob.input),
    output: parseJson(dbJob.output),

    status: dbJob.status as StateJobStatus,
    createdAt: sqliteDate(dbJob.created_at),
    scheduledAt: sqliteDate(dbJob.scheduled_at),
    completedAt: dbJob.completed_at ? sqliteDate(dbJob.completed_at) : null,
    completedBy: dbJob.completed_by,

    attempt: dbJob.attempt,
    lastAttemptError: parseJson(dbJob.last_attempt_error) as string | null,
    lastAttemptAt: dbJob.last_attempt_at ? sqliteDate(dbJob.last_attempt_at) : null,

    attemptAt: dbJob.attempt_at ? sqliteDate(dbJob.attempt_at) : null,
    attemptBy: dbJob.attempt_by,
    attemptUntil: dbJob.attempt_until ? sqliteDate(dbJob.attempt_until) : null,

    traceContext: dbJob.trace_context,
  };
};

/** The chain a head row stands for. Every chain fact lives on that one row. */
const mapDbHeadToStateChain = (head: DbJob): StateChainInfo => ({
  id: head.id,
  typeName: head.type_name,
  status: head.chain_status as StateChainStatus,
  deduplicationKey: head.deduplication_key,
  createdAt: sqliteDate(head.created_at),
  completedAt: head.chain_completed_at ? sqliteDate(head.chain_completed_at) : null,
  traceContext: head.chain_trace_context,
});

/** The same chain, read from the `c_`-prefixed columns a head-row join brings along. */
const mapDbChainColumns = (chainId: string, row: DbChainColumns): StateChainInfo => ({
  id: chainId,
  typeName: row.c_type_name!,
  status: row.c_status as StateChainStatus,
  deduplicationKey: row.c_deduplication_key,
  createdAt: sqliteDate(row.c_created_at!),
  completedAt: row.c_completed_at ? sqliteDate(row.c_completed_at) : null,
  traceContext: row.c_trace_context,
});

const mapDbJobRowToStateJob = (row: DbJob & DbChainColumns): StateJob => ({
  ...mapDbJobToStateJob(row),
  chain: mapDbChainColumns(row.chain_id, row),
});

const parseDbChainRow = (row: DbChainRow): { headJob: DbJob; tailJob: DbJob | null } => {
  const headJob: DbJob = {
    id: row.id,
    type_name: row.type_name,
    chain_id: row.chain_id,
    chain_index: row.chain_index,
    continued_to_id: row.continued_to_id,
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
    attempt_at: row.attempt_at,
    attempt_by: row.attempt_by,
    attempt_until: row.attempt_until,
    chain_status: row.chain_status,
    chain_completed_at: row.chain_completed_at,
    deduplication_key: row.deduplication_key,
    chain_trace_context: row.chain_trace_context,
    trace_context: row.trace_context,
  };

  const tailJob: DbJob | null = row.tail_id
    ? {
        id: row.tail_id,
        type_name: row.tail_type_name!,
        chain_id: row.tail_chain_id!,
        chain_index: row.tail_chain_index!,
        continued_to_id: row.tail_continued_to_id,
        input: row.tail_input,
        output: row.tail_output,
        status: row.tail_status!,
        created_at: row.tail_created_at!,
        scheduled_at: row.tail_scheduled_at!,
        completed_at: row.tail_completed_at,
        completed_by: row.tail_completed_by,
        attempt: row.tail_attempt!,
        last_attempt_at: row.tail_last_attempt_at,
        last_attempt_error: row.tail_last_attempt_error,
        attempt_at: row.tail_attempt_at,
        attempt_by: row.tail_attempt_by,
        attempt_until: row.tail_attempt_until,
        chain_status: row.tail_chain_status,
        chain_completed_at: row.tail_chain_completed_at,
        deduplication_key: row.tail_deduplication_key,
        chain_trace_context: row.tail_chain_trace_context,
        trace_context: row.tail_trace_context,
      }
    : null;

  return { headJob, tailJob };
};

/** `tail` is `undefined` when the head is the tail — a single-job chain. */
const mapDbChainRowToStateChain = (row: DbChainRow): StateChain => {
  const { headJob, tailJob } = parseDbChainRow(row);
  return {
    ...mapDbHeadToStateChain(headJob),
    head: mapDbJobToStateJob(headJob),
    tail: tailJob ? mapDbJobToStateJob(tailJob) : undefined,
  };
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
      chain_columns: chainColumnsSelect,
    },
  );

  const templateCache = createTemplateCache();

  const idDataType = t.string();
  const dbJobColumns = {
    id: idDataType,
    type_name: t.string(),
    chain_id: idDataType,
    chain_index: t.number(),
    continued_to_id: t["string?"](),
    input: t["string?"](),
    output: t["string?"](),
    status: t.string(),
    created_at: t.string(),
    scheduled_at: t.string(),
    completed_at: t["string?"](),
    completed_by: t["string?"](),
    attempt: t.number(),
    last_attempt_at: t["string?"](),
    last_attempt_error: t["string?"](),
    attempt_at: t["string?"](),
    attempt_by: t["string?"](),
    attempt_until: t["string?"](),
    chain_status: t["string?"](),
    chain_completed_at: t["string?"](),
    deduplication_key: t["string?"](),
    chain_trace_context: t["string?"](),
    trace_context: t["string?"](),
  } as const;

  /** The head row's chain columns, joined in next to a job row. */
  const dbChainColumns = {
    c_type_name: t["string?"](),
    c_status: t["string?"](),
    c_created_at: t["string?"](),
    c_completed_at: t["string?"](),
    c_deduplication_key: t["string?"](),
    c_trace_context: t["string?"](),
  } as const;

  const dbChainRowColumns = {
    ...dbJobColumns,
    tail_id: t["string?"](),
    tail_type_name: t["string?"](),
    tail_chain_id: t["string?"](),
    tail_chain_index: t["number?"](),
    tail_continued_to_id: t["string?"](),
    tail_input: t["string?"](),
    tail_output: t["string?"](),
    tail_status: t["string?"](),
    tail_created_at: t["string?"](),
    tail_scheduled_at: t["string?"](),
    tail_completed_at: t["string?"](),
    tail_completed_by: t["string?"](),
    tail_attempt: t["number?"](),
    tail_last_attempt_at: t["string?"](),
    tail_last_attempt_error: t["string?"](),
    tail_attempt_at: t["string?"](),
    tail_attempt_by: t["string?"](),
    tail_attempt_until: t["string?"](),
    tail_chain_status: t["string?"](),
    tail_chain_completed_at: t["string?"](),
    tail_deduplication_key: t["string?"](),
    tail_chain_trace_context: t["string?"](),
    tail_trace_context: t["string?"](),
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
      // The head row is the chain, so `lock` locks it — the tail is read, never locked.
      if (lock === "exclusive" && txCtx) {
        await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("lockChainHeads", () =>
            applyTemplate(
              sql(
                `
UPDATE {{table_prefix}}job
SET id = id
WHERE id IN (SELECT value FROM json_each(?))
  AND chain_index = 0
`,
                {
                  id: "lockChainHeads",
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
  {{job_columns:head_job}},
  {{job_columns_prefixed:tail_job:tail_}}
FROM {{table_prefix}}job AS head_job${tailJoin("head_job")}
WHERE head_job.id IN (SELECT value FROM json_each(?))
  AND head_job.chain_index = 0
ORDER BY head_job.id
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
      const byId = new Map(rows.map((row) => [row.id, row]));
      return chainIds.map((chainId) => {
        const row = byId.get(chainId as string);
        return row ? mapDbChainRowToStateChain(row) : undefined;
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
      const idsJson = JSON.stringify(jobIds);
      if (lock === "exclusive" && txCtx) {
        // The lock covers each job and its chain's head row: completing a job writes the
        // head, so a caller holding this lock must hold the head too.
        await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("lockJobs", () =>
            applyTemplate(
              sql(
                `
UPDATE {{table_prefix}}job
SET id = id
WHERE id IN (
  SELECT value FROM json_each(?)
  UNION
  SELECT chain_id FROM {{table_prefix}}job WHERE id IN (SELECT value FROM json_each(?))
)
`,
                {
                  id: "lockJobs",
                  params: [t.string(), t.string()],
                  columns: {} as Record<string, never>,
                },
              ),
            ),
          ),
          params: [idsJson, idsJson],
        });
      }
      // The head row of a head row is itself, so the join costs one primary-key lookup.
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getJobs", () =>
          applyTemplate(
            sql(
              `
SELECT {{job_columns:j}}, {{chain_columns:h}}
FROM {{table_prefix}}job j
JOIN {{table_prefix}}job h ON h.id = j.chain_id
WHERE j.id IN (SELECT value FROM json_each(?))
`,
              {
                id: "getJobs",
                params: [t.string()],
                columns: { ...dbJobColumns, ...dbChainColumns },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [idsJson],
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return jobIds.map((jobId) => {
        const row = byId.get(jobId as string);
        return row ? mapDbJobRowToStateJob(row) : undefined;
      });
    }) as StateAdapter<TTxContext, TIdType>["getJobs"],

    createJobs: async ({ txCtx, jobs }) => {
      for (const job of jobs) {
        if (job.id !== undefined) validateId(job.id, "caller");
      }
      const results: (StateChain & { deduplicated: boolean })[] = Array.from({
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

          const batchKey = `${deduplicationKey}\0${job.typeName}`;
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
SELECT *
FROM {{table_prefix}}job
WHERE ? IS NOT NULL
  AND deduplication_key = ?
  AND chain_index = 0
  AND type_name = ?
  AND (
    (? = 'running' AND chain_status = 'running')
    OR (? = 'any')
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
                    ],
                    columns: { ...dbJobColumns },
                    readOnly: true,
                  },
                ),
              ),
            ),
            params: [
              deduplicationKey,
              deduplicationKey,
              job.typeName,
              deduplicationScope,
              deduplicationScope,
            ],
          });

          if (existingDeduplicated) {
            results[i] = {
              ...mapDbHeadToStateChain(existingDeduplicated),
              head: mapDbJobToStateJob(existingDeduplicated),
              tail: undefined,
              deduplicated: true,
            };
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
    json_extract(je.value, '$.input')                   AS input,
    json_extract(je.value, '$.deduplication_key')       AS deduplication_key,
    json_extract(je.value, '$.scheduled_at')            AS sched_at,
    json_extract(je.value, '$.schedule_after_ms')       AS sched_after_ms,
    json_extract(je.value, '$.chain_trace_context')     AS chain_trace_context,
    json_extract(je.value, '$.trace_context')           AS trace_context
  FROM json_each(?) AS je
)
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_index, chain_status, input, deduplication_key, scheduled_at, chain_trace_context, trace_context)
SELECT
  d.new_id,
  d.type_name,
  d.new_id,
  0,
  'running',
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
            ...mapDbHeadToStateChain(row),
            head: mapDbJobToStateJob(row),
            tail: undefined,
            deduplicated: false,
          };
        }
      }

      for (const { index, firstIndex } of deferredDupes) {
        results[index] = { ...results[firstIndex], deduplicated: true };
      }

      return results;
    },

    continueJobs: async ({ txCtx, completedBy, jobs }) => {
      if (jobs.length === 0) return [];
      for (const job of jobs) {
        if (job.id !== undefined) validateId(job.id, "caller");
      }

      const entries = jobs.map((job) => ({
        new_id: job.id ?? generateId(),
        type_name: job.typeName,
        input: job.input !== undefined ? JSON.stringify(job.input) : null,
        scheduled_at: job.schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null,
        schedule_after_ms: job.schedule?.afterMs ?? null,
        trace_context: job.traceContext ?? null,
        continue_from_id: job.continueFromId as string,
      }));
      const payload = JSON.stringify(entries);

      // The successor is inserted first so the predecessor's `continued_to_id`
      // has a row to point at.
      const insertedRows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("insertContinuations", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT
    je.key                                              AS ord,
    json_extract(je.value, '$.new_id')                  AS new_id,
    json_extract(je.value, '$.type_name')               AS type_name,
    json_extract(je.value, '$.input')                   AS input,
    json_extract(je.value, '$.scheduled_at')            AS sched_at,
    json_extract(je.value, '$.schedule_after_ms')       AS sched_after_ms,
    json_extract(je.value, '$.trace_context')           AS trace_context,
    json_extract(je.value, '$.continue_from_id')        AS continue_from_id
  FROM json_each(?) AS je
)
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_index, input, scheduled_at, trace_context)
SELECT
  d.new_id,
  d.type_name,
  p.chain_id,
  p.chain_index + 1,
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
  d.trace_context
FROM input_data d
JOIN {{table_prefix}}job p ON p.id = d.continue_from_id AND p.status <> 'completed'
ORDER BY d.ord
RETURNING *
`,
              {
                id: "insertContinuations",
                params: [t.string()],
                columns: { ...dbJobColumns },
              },
            ),
          ),
        ),
        params: [payload],
      });

      const completedRows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("completeContinuedJobs", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT
    json_extract(je.value, '$.new_id')           AS new_id,
    json_extract(je.value, '$.continue_from_id') AS continue_from_id
  FROM json_each(?) AS je
)
UPDATE {{table_prefix}}job
SET status = 'completed',
  completed_at = datetime('now', 'subsec'),
  completed_by = ?,
  continued_to_id = d.new_id,
  output = NULL,
  last_attempt_error = NULL,
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL
FROM input_data d
WHERE {{table_prefix}}job.id = d.continue_from_id
  AND {{table_prefix}}job.status <> 'completed'
  -- The insert above ran first, so exclude this batch's own successors: an entry
  -- must not be able to continue a job another entry in the same batch creates.
  AND {{table_prefix}}job.id NOT IN (SELECT new_id FROM input_data)
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
              {
                id: "completeContinuedJobs",
                params: [t.string(), t["string?"]()],
                columns: { ...dbJobColumns, ...dbChainColumns },
              },
            ),
          ),
        ),
        params: [payload, completedBy ?? null],
      });

      const insertedById = new Map(insertedRows.map((row) => [row.id, row]));
      const completedById = new Map(completedRows.map((row) => [row.id, row]));

      return entries.map((entry) => {
        // Nothing completed for this entry: its predecessor is gone or already
        // completed, which the caller reads as a hole rather than an error.
        const completedRow = completedById.get(entry.continue_from_id);
        if (!completedRow) return undefined;
        return {
          ...mapDbJobRowToStateJob(completedRow),
          continuation: mapDbJobToStateJob(insertedById.get(entry.new_id)!),
        };
      });
    },

    completeJobs: async ({ txCtx, completedBy, jobs }) => {
      if (jobs.length === 0) return [];

      const entries = jobs.map((job) => ({
        job_id: job.jobId as string,
        output: job.output !== undefined ? JSON.stringify(job.output) : null,
      }));
      const payload = JSON.stringify(entries);

      // One statement, per-row CASE. A single-job chain's head and completing job are
      // the same row, and two statements would each re-read it: one of the two writes
      // would be silently discarded.
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("completeJobs", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT
    json_extract(je.value, '$.job_id') AS job_id,
    json_extract(je.value, '$.output') AS output
  FROM json_each(?) AS je
),
targets AS (
  SELECT d.job_id, d.output, j.chain_id
  FROM input_data d
  JOIN {{table_prefix}}job j ON j.id = d.job_id AND j.status <> 'completed'
),
row_effects AS (
  SELECT
    ids.id,
    (SELECT tg.output FROM targets tg WHERE tg.job_id = ids.id) AS output,
    EXISTS (SELECT 1 FROM targets tg WHERE tg.job_id = ids.id) AS completes_job,
    EXISTS (SELECT 1 FROM targets tg WHERE tg.chain_id = ids.id) AS completes_chain
  FROM (
    SELECT job_id AS id FROM targets
    UNION
    SELECT chain_id AS id FROM targets
  ) ids
)
UPDATE {{table_prefix}}job
SET status = CASE WHEN e.completes_job THEN 'completed' ELSE {{table_prefix}}job.status END,
  last_attempt_error = CASE WHEN e.completes_job THEN NULL ELSE {{table_prefix}}job.last_attempt_error END,
  attempt_at = CASE WHEN e.completes_job THEN NULL ELSE {{table_prefix}}job.attempt_at END,
  attempt_by = CASE WHEN e.completes_job THEN NULL ELSE {{table_prefix}}job.attempt_by END,
  attempt_until = CASE WHEN e.completes_job THEN NULL ELSE {{table_prefix}}job.attempt_until END,
  completed_at = CASE WHEN e.completes_job THEN datetime('now', 'subsec') ELSE {{table_prefix}}job.completed_at END,
  completed_by = CASE WHEN e.completes_job THEN ? ELSE {{table_prefix}}job.completed_by END,
  output = CASE WHEN e.completes_job THEN e.output ELSE {{table_prefix}}job.output END,
  chain_status = CASE WHEN e.completes_chain THEN 'completed' ELSE {{table_prefix}}job.chain_status END,
  chain_completed_at = CASE WHEN e.completes_chain AND {{table_prefix}}job.chain_completed_at IS NULL
                            THEN datetime('now', 'subsec') ELSE {{table_prefix}}job.chain_completed_at END
FROM row_effects e
WHERE {{table_prefix}}job.id = e.id
RETURNING *, EXISTS (
  SELECT 1 FROM {{table_prefix}}job_blocker jb
  WHERE jb.blocked_by_chain_id = {{table_prefix}}job.chain_id
) AS has_blocking
`,
              {
                id: "completeJobs",
                params: [t.string(), t["string?"]()],
                columns: { ...dbJobColumns, has_blocking: t.number() },
              },
            ),
          ),
        ),
        params: [payload, completedBy ?? null],
      });

      // The head row is always in the result set: it is either the completing row itself
      // or the second row the statement touched.
      const rowById = new Map(rows.map((row) => [row.id, row]));

      return jobs.map((job) => {
        // No row means the id matched no job, or one already completed: a hole in the
        // result the caller reads, not an error this layer raises.
        const row = rowById.get(job.jobId);
        if (!row) return undefined;
        return {
          ...mapDbJobToStateJob(row),
          chain: mapDbHeadToStateChain(rowById.get(row.chain_id)!),
          hasBlockedJobs: row.has_blocking === 1,
        };
      });
    },

    rescheduleJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];
      const entries = jobs.map((job) => ({
        job_id: job.jobId as string,
        at: job.schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null,
        after_ms: job.schedule?.afterMs ?? null,
        error: job.error !== undefined ? JSON.stringify(job.error) : null,
      }));
      const payload = JSON.stringify(entries);
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("rescheduleJobs", () =>
          applyTemplate(
            sql(
              `
WITH input_data AS (
  SELECT
    json_extract(je.value, '$.job_id')  AS job_id,
    json_extract(je.value, '$.at')       AS at,
    json_extract(je.value, '$.after_ms') AS after_ms,
    json_extract(je.value, '$.error')    AS error
  FROM json_each(?) AS je
)
UPDATE {{table_prefix}}job
SET status = CASE WHEN {{table_prefix}}job.status = 'running' THEN 'pending' ELSE {{table_prefix}}job.status END,
  scheduled_at = MAX(
    COALESCE(d.at,
      CASE WHEN d.after_ms IS NOT NULL THEN datetime('now', 'subsec', '+' || (d.after_ms / 1000.0) || ' seconds') ELSE NULL END,
      datetime('now', 'subsec')),
    datetime('now', 'subsec')),
  last_attempt_at = CASE WHEN {{table_prefix}}job.status = 'running' THEN datetime('now', 'subsec') ELSE last_attempt_at END,
  last_attempt_error = CASE WHEN {{table_prefix}}job.status = 'running' THEN d.error ELSE last_attempt_error END,
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL
FROM input_data d
WHERE {{table_prefix}}job.id = d.job_id
  AND {{table_prefix}}job.status <> 'completed'
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
              {
                id: "rescheduleJobs",
                params: [t.string()],
                columns: { ...dbJobColumns, ...dbChainColumns },
              },
            ),
          ),
        ),
        params: [payload],
      });
      const rowById = new Map(rows.map((row) => [row.id, row]));
      return jobs.map((job) => {
        const row = rowById.get(job.jobId as string);
        return row ? mapDbJobRowToStateJob(row) : undefined;
      });
    },

    deleteChains: async ({ txCtx, chainIds }) => {
      if (chainIds.length === 0) return [];

      const chainIdsJson = JSON.stringify(chainIds);

      // Fetch existing chains.
      const chainRows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getChainsByChainIds", () =>
          applyTemplate(
            sql(
              `
SELECT
  {{job_columns:head_job}},
  {{job_columns_prefixed:tail_job:tail_}}
FROM {{table_prefix}}job AS head_job${tailJoin("head_job")}
WHERE head_job.id IN (SELECT value FROM json_each(?))
  AND head_job.chain_index = 0
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
      const chainRowById = new Map(chainRows.map((row) => [row.id, row]));

      // Find external blocker refs with full details for per-chain verdicts.
      const blockerRefRows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getExternalBlockerDetails", () =>
          applyTemplate(
            sql(
              `
SELECT
  jb.job_id AS blocker_job_id,
  jb.blocked_by_chain_id AS blocker_chain_id,
  jb."index" AS blocker_index,
  jb.trace_context AS blocker_trace_context,
  {{job_columns:j}}
FROM {{table_prefix}}job_blocker jb
JOIN {{table_prefix}}job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id IN (SELECT value FROM json_each(?))
  AND j.chain_id NOT IN (SELECT value FROM json_each(?))
`,
              {
                id: "getExternalBlockerDetails",
                params: [t.string(), t.string()],
                columns: {
                  blocker_job_id: idDataType,
                  blocker_chain_id: idDataType,
                  blocker_index: t.number(),
                  blocker_trace_context: t["string?"](),
                  ...dbJobColumns,
                },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [chainIdsJson, chainIdsJson],
      });

      // Group blockers by the chain they block on.
      const blockersByChain = new Map<string, StateBlockedJob[]>();
      for (const ref of blockerRefRows) {
        const blockedJob: StateBlockedJob = {
          jobId: ref.blocker_job_id,
          blockedByChainId: ref.blocker_chain_id,
          index: ref.blocker_index,
          traceContext: ref.blocker_trace_context,
          job: mapDbJobToStateJob(ref),
        };
        const existing = blockersByChain.get(ref.blocker_chain_id);
        if (existing) existing.push(blockedJob);
        else blockersByChain.set(ref.blocker_chain_id, [blockedJob]);
      }

      // Delete chains that exist and have no external blockers.
      const chainsToDelete = chainIds.filter(
        (id) => chainRowById.has(id as string) && !blockersByChain.has(id as string),
      );

      if (chainsToDelete.length > 0) {
        const deleteJson = JSON.stringify(chainsToDelete);
        await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("deleteBlockersByChainIds", () =>
            applyTemplate(
              sql(
                `
DELETE FROM {{table_prefix}}job_blocker
WHERE job_id IN (
  SELECT id FROM {{table_prefix}}job
  WHERE (id IN (SELECT value FROM json_each(?)) AND chain_index = 0)
     OR (chain_id IN (SELECT value FROM json_each(?)) AND chain_index > 0)
)
`,
                {
                  id: "deleteBlockersByChainIds",
                  params: [t.string(), t.string()],
                  columns: {},
                },
              ),
            ),
          ),
          params: [deleteJson, deleteJson],
        });
        await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("deleteChains", () =>
            applyTemplate(
              sql(
                `
DELETE FROM {{table_prefix}}job
WHERE (id IN (SELECT value FROM json_each(?)) AND chain_index = 0)
   OR (chain_id IN (SELECT value FROM json_each(?)) AND chain_index > 0)
`,
                {
                  id: "deleteChains",
                  params: [t.string(), t.string()],
                  columns: {},
                },
              ),
            ),
          ),
          params: [deleteJson, deleteJson],
        });
      }

      // Build per-input results.
      return chainIds.map((chainId) => {
        const blockers = blockersByChain.get(chainId as string);
        if (blockers) return blockers;
        const row = chainRowById.get(chainId as string);
        if (!row) return undefined;
        return mapDbChainRowToStateChain(row);
      });
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
SET status = 'running',
  attempt = attempt + 1,
  attempt_at = datetime('now', 'subsec'),
  attempt_by = ?
WHERE id = (
  SELECT id
  FROM {{table_prefix}}job INDEXED BY {{table_prefix}}job_ready_idx
  WHERE type_name IN (SELECT value FROM json_each(?))
    AND status = 'pending'
    AND scheduled_at <= datetime('now', 'subsec')
  ORDER BY scheduled_at ASC
  LIMIT 1
)
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}, EXISTS (
  SELECT 1 FROM {{table_prefix}}job_blocker jb WHERE jb.job_id = {{table_prefix}}job.id
) AS has_blockers
`,
              {
                id: "startJobAttempt",
                params: [t.string(), t.string()],
                columns: { ...dbJobColumns, ...dbChainColumns, has_blockers: t.number() },
              },
            ),
          ),
        ),
        params: [workerId, typeNamesJson],
      });

      if (!result) return undefined;
      return {
        ...mapDbJobRowToStateJob(result),
        hasBlockers: result.has_blockers === 1,
      };
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
  AND job.status = 'pending'
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
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
              {
                id: "extendJobAttempt",
                params: [t.number(), idDataType, t.string()],
                columns: { ...dbJobColumns, ...dbChainColumns },
              },
            ),
          ),
        ),
        params: [timeoutMs, jobId, workerId],
      });

      // No row means no job with this id holds an attempt by this worker.
      return job ? mapDbJobRowToStateJob(job) : undefined;
    },
    reclaimExpiredJobAttempt: async ({ txCtx, typeNames, ignoredJobIds }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("reclaimExpiredJobAttempt", () =>
          applyTemplate(
            sql(
              `
UPDATE {{table_prefix}}job
SET status = 'pending',
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_until = NULL
WHERE id = (
  SELECT id
  FROM {{table_prefix}}job INDEXED BY {{table_prefix}}job_running_idx
  WHERE status = 'running'
    AND attempt_until IS NOT NULL
    AND attempt_until <= datetime('now', 'subsec')
    AND type_name IN (SELECT value FROM json_each(?))
    AND id NOT IN (SELECT value FROM json_each(?))
  ORDER BY attempt_until ASC
  LIMIT 1
)
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
              {
                id: "reclaimExpiredJobAttempt",
                params: [t.string(), t.string()],
                columns: { ...dbJobColumns, ...dbChainColumns },
              },
            ),
          ),
        ),
        params: [JSON.stringify(typeNames), JSON.stringify(ignoredJobIds ?? [])],
      });
      return job ? mapDbJobRowToStateJob(job) : undefined;
    },
    addJobsBlockers: async ({ txCtx, jobBlockers }) => {
      if (jobBlockers.length === 0) return [];

      const rows = jobBlockers.flatMap(({ jobId, blockedByChainIds, blockerTraceContexts }) =>
        blockedByChainIds.map((blockedByChainId, index) => ({
          job_id: jobId as string,
          blocked_by_chain_id: blockedByChainId as string,
          index,
          trace_context: blockerTraceContexts?.[index] ?? null,
        })),
      );
      const payload = JSON.stringify(rows);

      await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("insertJobBlockers", () =>
          applyTemplate(
            sql(
              `
INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT
  json_extract(je.value, '$.job_id'),
  json_extract(je.value, '$.blocked_by_chain_id'),
  json_extract(je.value, '$.index'),
  json_extract(je.value, '$.trace_context')
FROM json_each(?) AS je
`,
              {
                id: "insertJobBlockers",
                params: [t.string()],
                columns: {},
              },
            ),
          ),
        ),
        params: [payload],
      });

      // One join against each blocker chain's head row: completeness is its
      // `chain_status`, and a chain missing from the join is the check
      // `blocked_by_chain_id`'s dropped foreign key used to perform.
      const blockerRows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getBlockerChains", () =>
          applyTemplate(
            sql(
              `
SELECT
  d.ord,
  d.blocked_by_chain_id,
  {{chain_columns:h}}
FROM (
  SELECT
    je.key                                            AS ord,
    json_extract(je.value, '$.blocked_by_chain_id')   AS blocked_by_chain_id
  FROM json_each(?) AS je
) AS d
LEFT JOIN {{table_prefix}}job h
  ON h.id = d.blocked_by_chain_id AND h.chain_index = 0
ORDER BY d.ord
`,
              {
                id: "getBlockerChains",
                params: [t.string()],
                columns: { ord: t.number(), blocked_by_chain_id: idDataType, ...dbChainColumns },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [payload],
      });

      const blockerChains: (StateChainInfo | undefined)[] = blockerRows.map((row) => {
        // An id that names no chain head comes back as a hole for the caller to turn
        // into an error; the blocker rows already inserted for the other positions go
        // away with the transaction it aborts.
        if (row.c_type_name === null) return undefined;
        return mapDbChainColumns(row.blocked_by_chain_id, row);
      });

      const blockersByJobId = new Map<string, (StateChainInfo | undefined)[]>();
      const jobIdsToBlock = new Set<string>();
      for (const [ord, row] of rows.entries()) {
        const chain = blockerChains[ord];
        const existing = blockersByJobId.get(row.job_id);
        if (existing) existing.push(chain);
        else blockersByJobId.set(row.job_id, [chain]);
        if (chain?.status === "running") jobIdsToBlock.add(row.job_id);
      }

      const jobRowById = new Map<string, DbJob & DbChainColumns>();
      if (jobIdsToBlock.size > 0) {
        const updated = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("updateJobsToBlocked", () =>
            applyTemplate(
              sql(
                `
UPDATE {{table_prefix}}job
SET status = 'blocked'
WHERE id IN (SELECT value FROM json_each(?))
  AND status = 'pending'
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
                {
                  id: "updateJobsToBlocked",
                  params: [t.string()],
                  columns: { ...dbJobColumns, ...dbChainColumns },
                },
              ),
            ),
          ),
          params: [JSON.stringify([...jobIdsToBlock])],
        });
        for (const row of updated) jobRowById.set(row.id, row);
      }

      const remainingJobIds = [...blockersByJobId.keys()].filter((id) => !jobRowById.has(id));
      if (remainingJobIds.length > 0) {
        const remaining = await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("getJobsForBlockers", () =>
            applyTemplate(
              sql(
                /* sql */ `SELECT {{job_columns:j}}, {{chain_columns:h}} FROM {{table_prefix}}job j JOIN {{table_prefix}}job h ON h.id = j.chain_id WHERE j.id IN (SELECT value FROM json_each(?))`,
                {
                  id: "getJobsForBlockers",
                  params: [t.string()],
                  columns: { ...dbJobColumns, ...dbChainColumns },
                  readOnly: true,
                },
              ),
            ),
          ),
          params: [JSON.stringify(remainingJobIds)],
        });
        for (const row of remaining) jobRowById.set(row.id, row);
      }

      return jobBlockers.map(({ jobId }) => ({
        ...mapDbJobRowToStateJob(jobRowById.get(jobId as string)!),
        blockers: blockersByJobId.get(jobId as string) ?? [],
      }));
    },

    getJobBlockers: async ({ txCtx, jobId }) => {
      const rows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getJobBlockers", () =>
          applyTemplate(
            sql(
              `
SELECT
  {{job_columns:head_job}},
  {{job_columns_prefixed:tail_job:tail_}}
FROM {{table_prefix}}job_blocker AS b
JOIN {{table_prefix}}job AS head_job
  ON head_job.id = b.blocked_by_chain_id${tailJoin("head_job")}
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

      return rows.map(mapDbChainRowToStateChain);
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
    h.chain_status = 'completed' AS blocker_complete
  FROM {{table_prefix}}job_blocker jb
  LEFT JOIN {{table_prefix}}job h ON h.id = jb.blocked_by_chain_id
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
      if (readyJobIds.length > 0) {
        await executeTypedSql({
          txCtx,
          sql: templateCache.getOrCompute("scheduleBlockedJobs", () =>
            applyTemplate(
              sql(
                `
UPDATE {{table_prefix}}job
SET status = 'pending',
  scheduled_at = MAX(scheduled_at, datetime('now', 'subsec'))
WHERE id IN (SELECT value FROM json_each(?)) AND status = 'blocked'
`,
                {
                  id: "scheduleBlockedJobs",
                  params: [t.string()],
                  columns: {},
                },
              ),
            ),
          ),
          params: [JSON.stringify(readyJobIds)],
        });
      }

      // Fetch blocker rows with full job info (after unblocking).
      const blockerRows = await executeTypedSql({
        txCtx,
        sql: templateCache.getOrCompute("getChainJobBlockersWithJobs", () =>
          applyTemplate(
            sql(
              `
SELECT
  jb.job_id AS blocker_job_id,
  jb.blocked_by_chain_id AS blocker_chain_id,
  jb."index" AS blocker_index,
  jb.trace_context AS blocker_trace_context,
  {{job_columns:j}}
FROM {{table_prefix}}job_blocker jb
JOIN {{table_prefix}}job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id = ?
ORDER BY jb.job_id, jb."index"
`,
              {
                id: "getChainJobBlockersWithJobs",
                params: [idDataType],
                columns: {
                  blocker_job_id: idDataType,
                  blocker_chain_id: idDataType,
                  blocker_index: t.number(),
                  blocker_trace_context: t["string?"](),
                  ...dbJobColumns,
                },
                readOnly: true,
              },
            ),
          ),
        ),
        params: [blockedByChainId],
      });

      return blockerRows.map(
        (row): StateBlockedJob => ({
          jobId: row.blocker_job_id,
          blockedByChainId: row.blocker_chain_id,
          index: row.blocker_index,
          traceContext: row.blocker_trace_context,
          job: mapDbJobToStateJob(row),
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
  SELECT min(type_name) AS type_name FROM ${tablePrefix}job WHERE chain_index = 0
  UNION ALL
  SELECT (SELECT min(type_name) FROM ${tablePrefix}job WHERE chain_index = 0 AND type_name > types.type_name)
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
  SELECT min(type_name) AS type_name FROM ${tablePrefix}job
  UNION ALL
  SELECT (SELECT min(type_name) FROM ${tablePrefix}job WHERE type_name > types.type_name)
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
  je.value AS name,
  (SELECT count(*) FROM (
    SELECT 1 FROM ${tablePrefix}job
    WHERE type_name = je.value AND chain_index = 0 AND chain_status = 'running'
    LIMIT ${COUNT_CAP + 1}
  )) AS running_cnt,
  (SELECT count(*) FROM (
    SELECT 1 FROM ${tablePrefix}job
    WHERE type_name = je.value AND chain_index = 0 AND chain_status = 'completed'
    LIMIT ${COUNT_CAP + 1}
  )) AS completed_cnt
FROM json_each(?) AS je
`,
              {
                id: "countByChainTypeNames",
                params: [t.string()],
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
        params: [JSON.stringify(typeNames)],
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
  je.value AS name,
  (SELECT count(*) FROM (SELECT 1 FROM ${tablePrefix}job WHERE type_name = je.value AND status = 'blocked' LIMIT ${COUNT_CAP + 1})) AS blocked_cnt,
  (SELECT count(*) FROM (SELECT 1 FROM ${tablePrefix}job WHERE type_name = je.value AND status = 'pending' LIMIT ${COUNT_CAP + 1})) AS pending_cnt,
  (SELECT count(*) FROM (SELECT 1 FROM ${tablePrefix}job WHERE type_name = je.value AND status = 'running' LIMIT ${COUNT_CAP + 1})) AS running_cnt,
  (SELECT count(*) FROM (SELECT 1 FROM ${tablePrefix}job WHERE type_name = je.value AND status = 'completed' LIMIT ${COUNT_CAP + 1})) AS completed_cnt
FROM json_each(?) AS je
`,
              {
                id: "countByJobTypeNames",
                params: [t.string()],
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
        params: [JSON.stringify(typeNames)],
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
      // Head-anchored: every chain fact is on the head row, so one shape serves
      // every status and both orderings.
      const orderColumn = orderBy === "completedAt" ? "chain_completed_at" : "created_at";
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, orderBy) : null;
      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";

      const conditions: string[] = ["head_job.chain_index = 0"];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];

      if (status !== undefined) {
        conditions.push(chainStatusConditions[status]);
      }

      conditions.push("head_job.type_name = ?");
      params.push(typeName);
      paramTypes.push(t.string());

      if (independent === true) {
        conditions.push(
          `NOT EXISTS (SELECT 1 FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = head_job.id)`,
        );
      } else if (independent === false) {
        conditions.push(
          `EXISTS (SELECT 1 FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = head_job.id)`,
        );
      }

      if (from) {
        conditions.push(`head_job.${orderColumn} >= ?`);
        params.push(isoToSqlite(from.toISOString()));
        paramTypes.push(t.string());
      }
      if (to) {
        conditions.push(`head_job.${orderColumn} <= ?`);
        params.push(isoToSqlite(to.toISOString()));
        paramTypes.push(t.string());
      }

      if (cursor) {
        const cursorValue = isoToSqlite(cursor.value);
        const cmp = orderDirection === "desc" ? "<" : ">";
        conditions.push(
          `(head_job.${orderColumn} ${cmp} ? OR (head_job.${orderColumn} = ? AND head_job.id ${cmp} ?))`,
        );
        params.push(cursorValue, cursorValue, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      // The page is cut from the head rows first, so the tail join runs `limit` times
      // instead of once per matching chain.
      const sqlStr = `SELECT {{job_columns:head_job}}, {{job_columns_prefixed:tail_job:tail_}} FROM (SELECT head_job.* FROM ${tablePrefix}job AS head_job WHERE ${conditions.join(" AND ")} ORDER BY head_job.${orderColumn} ${orderDir}, head_job.id ${orderDir} LIMIT ?) AS head_job${tailJoin("head_job")} ORDER BY head_job.${orderColumn} ${orderDir}, head_job.id ${orderDir}`;

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
      const items = pageRows.map(mapDbChainRowToStateChain);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({
          type: "timestampWithId",
          sortKey: orderBy,
          value: sqliteDate(lastRow[orderColumn]!).toISOString(),
          id: lastRow.id,
        });
      }

      return { items, nextCursor };
    },

    listJobs: async ({ txCtx, typeName, from, to, status, orderBy, orderDirection, page }) => {
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

      if (status !== undefined) {
        conditions.push(jobStatusConditions[status]);
      }

      conditions.push("j.type_name = ?");
      params.push(typeName);
      paramTypes.push(t.string());
      if (from) {
        conditions.push(`j.${sortCol} >= ?`);
        params.push(isoToSqlite(from.toISOString()));
        paramTypes.push(t.string());
      }
      if (to) {
        conditions.push(`j.${sortCol} <= ?`);
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
      // The page is selected first, so the head-row join costs one primary-key lookup
      // per returned row instead of one per matching row; for a head row it is `j` itself.
      const sqlStr = `SELECT {{job_columns:j}}, {{chain_columns:h}} FROM (SELECT j.* FROM ${tablePrefix}job j ${where} ORDER BY j.${sortCol} ${orderDir}, j.id ${orderDir} LIMIT ?) j JOIN ${tablePrefix}job h ON h.id = j.chain_id ORDER BY j.${sortCol} ${orderDir}, j.id ${orderDir}`;

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
          value: sqliteDate(lastRow[sortCol as keyof DbJob] as string).toISOString(),
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

      // The whole page belongs to one chain, so its head is a single primary-key lookup
      // rather than a join per row.
      if (cursor) {
        const cmp = orderDirection === "asc" ? ">" : "<";
        params.length = 0;
        params.push(cursor.id, chainId, chainId, chainId, chainId, page.limit + 1);
        paramTypes.length = 0;
        paramTypes.push(idDataType, idDataType, idDataType, idDataType, idDataType, t.number());
        sqlStr = `WITH start_row AS (
          SELECT c.chain_index AS sc
          FROM ${tablePrefix}job c
          WHERE c.id = ? AND c.chain_id = ?
        )
        SELECT {{job_columns:j}}, {{chain_columns:h}}
        FROM ${tablePrefix}job j, start_row s, ${tablePrefix}job h
        WHERE ${chainMembers("j")}
          AND h.id = ?
          AND j.chain_index ${cmp} s.sc
        ORDER BY j.chain_index ${orderDir}, j.id ${orderDir}
        LIMIT ?`;
      } else {
        params.push(chainId, chainId, page.limit + 1);
        paramTypes.push(idDataType, idDataType, t.number());
        sqlStr = `SELECT {{job_columns:j}}, {{chain_columns:h}}
        FROM ${tablePrefix}job j, ${tablePrefix}job h
        WHERE ${chainMembers("j")}
          AND h.id = ?
        ORDER BY j.chain_index ${orderDir}, j.id ${orderDir}
        LIMIT ?`;
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
      const chain = pageRows[0] ? mapDbChainColumns(chainId, pageRows[0]) : undefined;
      const items = chain ? pageRows.map((row) => ({ ...mapDbJobToStateJob(row), chain })) : [];

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
      // The blocked jobs belong to other chains, so each page row joins its own head —
      // after the page is cut, so the join runs `limit` times, not once per match.
      const sqlStr = `SELECT {{job_columns:j}}, {{chain_columns:h}} FROM (SELECT j.* FROM ${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?) j JOIN ${tablePrefix}job h ON h.id = j.chain_id ORDER BY j.created_at ${orderDir}, j.id ${orderDir}`;

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
          value: sqliteDate(lastRow.created_at).toISOString(),
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

      const legacy = createLegacyUpgrade(stateProvider, applyTemplate, idDataType);
      return createMigrator<TTxContext>({
        migrations,
        store: createMigrationStore(stateProvider, applyTemplate),
        before: legacy.renameLegacySchemaAside,
        after: legacy.importLegacySchema,
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
