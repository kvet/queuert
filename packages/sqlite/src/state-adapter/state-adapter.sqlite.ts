import type { UUID } from "node:crypto";

import { createLatch } from "@queuert/helpers/latch";
import {
  type DataType,
  type InferColumns,
  type InferParams,
  type Migration,
  type MigrationResult,
  type MigrationStore,
  type TemplateApplier,
  type TypedSql,
  type TypedSqlTemplate,
  createMigrator,
  createTemplateApplier,
  createTemplateCache,
  extractColumnTypes,
  extractParamTypes,
  sql,
  t,
  createTemplateExecutor,
  validateSqlIdentifier,
} from "@queuert/typed-sql";
import {
  type BaseTxContext,
  SchemaFencedError,
  type StateAdapter,
  type StateBlockedJob,
  type StateChain,
  type StateChainInfo,
  type StateChainStatus,
  type StateCount,
  type StateDependentJob,
  type StateJob,
  type StateJobInfo,
  type StateJobStatus,
  type StateWorkerInfo,
} from "queuert";
import {
  decodeIdCursor,
  decodeTimestampWithIdCursor,
  encodeCursor,
  resolveStateAdapterConfig,
} from "queuert/internal";

import {
  createSqliteMigrationStore,
  takeWriteLockStatement,
} from "../migration-store/migration-store.sqlite.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";
import { createLegacyUpgrade } from "./legacy-upgrade.sqlite.ts";

const jobColumns = [
  "created_at",
  "scheduled_at",
  "completed_at",
  "last_attempt_at",
  "attempt_at",
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
  "attempt_token",
  "chain_deduplication_key",
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
    `${alias}.chain_deduplication_key AS c_deduplication_key`,
    `${alias}.chain_trace_context AS c_trace_context`,
  ].join(", ");

const chainColumnsReturning = (rowRef: string): string =>
  [
    ["type_name", "c_type_name"],
    ["chain_status", "c_status"],
    ["created_at", "c_created_at"],
    ["chain_completed_at", "c_completed_at"],
    ["chain_deduplication_key", "c_deduplication_key"],
    ["chain_trace_context", "c_trace_context"],
  ]
    .map(
      ([column, alias]) =>
        `(SELECT h.${column} FROM {{table_prefix}}job h WHERE h.id = ${rowRef}.chain_id) AS ${alias}`,
    )
    .join(", ");

const chainMembers = (alias: string): string =>
  `((${alias}.id = ? AND ${alias}.chain_index = 0) OR (${alias}.chain_id = ? AND ${alias}.chain_index > 0))`;

const tailJoin = (headAlias: string): string => `
LEFT JOIN {{table_prefix}}job AS tail_job
  ON tail_job.chain_id = ${headAlias}.id
  AND tail_job.chain_index > 0
  AND tail_job.chain_index = (
    SELECT MAX(t.chain_index) FROM {{table_prefix}}job t
    WHERE t.chain_id = ${headAlias}.id AND t.chain_index > 0
  )`;

/** Clamps a count read with `LIMIT countCap + 1` to `countCap`, flagging that more exist. */
const capCount = (count: number, countCap: number): StateCount => ({
  count: Math.min(count, countCap),
  hasMore: count > countCap,
});

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
  attempt_token: t["string?"](),
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

const dbWorkerColumns = {
  id: t.string(),
  type_names: t.string(),
  concurrency: t.number(),
  started_at: t.string(),
  lease_until: t.string(),
  token: t.string(),
  expired: t.number(),
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
  tail_attempt_token: t["string?"](),
  tail_chain_status: t["string?"](),
  tail_chain_completed_at: t["string?"](),
  tail_chain_deduplication_key: t["string?"](),
  tail_chain_trace_context: t["string?"](),
  tail_trace_context: t["string?"](),
} as const;

const dbBlockerColumns = {
  blocker_job_id: idDataType,
  blocker_chain_id: idDataType,
  blocker_index: t.number(),
  blocker_trace_context: t["string?"](),
} as const;

type DbJob = InferColumns<typeof dbJobColumns>;
type DbChainColumns = InferColumns<typeof dbChainColumns>;
type DbWorker = InferColumns<typeof dbWorkerColumns>;
type DbChainRow = InferColumns<typeof dbChainRowColumns>;

const SCHEMA_VERSION = 1;

const MIN_SQLITE_VERSION = "3.42";

const isVersionAtLeast = (version: string, minimum: string): boolean => {
  const parts = version.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  const differing = minimumParts.findIndex((part, index) => (parts[index] ?? 0) !== part);
  return differing === -1 || (parts[differing] ?? 0) > minimumParts[differing];
};

const FENCE_GUARD = "NOT EXISTS (SELECT 1 FROM {{fence_table}} WHERE 1 = 0)";

export const createSchemaMigrations = <TTxContext>(
  execute: (txCtx: TTxContext, statement: TypedSqlTemplate<readonly []>) => Promise<void>,
): Migration<TTxContext>[] => [
  {
    name: "001_initial_schema",
    up: async (txCtx) => {
      for (const statement of [
        sql(/* sql */ `
CREATE TABLE {{table_prefix}}job (
  created_at                    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  scheduled_at                  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  completed_at                  TEXT,
  last_attempt_at               TEXT,
  attempt_at                    TEXT,
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
  output                        TEXT,
  attempt_token                 TEXT
)`),
        sql(/* sql */ `
CREATE UNIQUE INDEX {{table_prefix}}chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)
WHERE chain_index > 0`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_deduplication_idx
ON {{table_prefix}}job (chain_deduplication_key, created_at DESC)
WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_idx
ON {{table_prefix}}job (type_name, created_at)`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_pending_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_blocked_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'blocked'`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_running_idx
ON {{table_prefix}}job (type_name, attempt_at)
WHERE status = 'running'`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_completed_idx
ON {{table_prefix}}job (type_name, completed_at)
WHERE status = 'completed'`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_attempt_by_idx
ON {{table_prefix}}job (attempt_by, attempt_at)
WHERE status = 'running'`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_idx
ON {{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_running_idx
ON {{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0 AND chain_status = 'running'`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_completed_idx
ON {{table_prefix}}job (type_name, chain_completed_at)
WHERE chain_index = 0 AND chain_status = 'completed'`),
        sql(/* sql */ `
CREATE TABLE {{table_prefix}}job_blocker (
  job_id                        {{job_id_type}} NOT NULL,
  blocked_by_chain_id           {{job_id_type}} NOT NULL,
  "index"                       INTEGER NOT NULL,
  trace_context                 TEXT,
  PRIMARY KEY (job_id, blocked_by_chain_id, "index")
)`),
        sql(/* sql */ `
CREATE INDEX {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`),
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
CREATE INDEX {{table_prefix}}worker_idx
ON {{table_prefix}}worker (started_at)`),
        sql(/* sql */ `
CREATE TABLE {{table_prefix}}schema_fence_v1 (id INTEGER PRIMARY KEY)`),
      ]) {
        await execute(txCtx, statement);
      }
    },
    down: async () => {
      throw new Error("The Queuert schema cannot be reverted.");
    },
  },
];

/** @internal */
export const createMigrationStore = <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
): MigrationStore<TTxContext> =>
  createSqliteMigrationStore({
    stateProvider,
    migrationTable: applyTemplate(sql("{{migration_table}}")).sql,
    writeLockTable: applyTemplate(sql("{{write_lock_table}}")).sql,
    lease: false,
  });

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

const mapDbJobToStateJob = (row: DbJob): StateJobInfo => ({
  id: row.id,
  typeName: row.type_name,
  chainId: row.chain_id,
  chainIndex: row.chain_index,
  continuedToId: row.continued_to_id,
  input: parseJson(row.input),
  output: parseJson(row.output),
  status: row.status as StateJobStatus,
  createdAt: sqliteDate(row.created_at),
  scheduledAt: sqliteDate(row.scheduled_at),
  completedAt: row.completed_at ? sqliteDate(row.completed_at) : null,
  completedBy: row.completed_by,
  attempt: row.attempt,
  lastAttemptError: parseJson(row.last_attempt_error) as string | null,
  lastAttemptAt: row.last_attempt_at ? sqliteDate(row.last_attempt_at) : null,
  attemptAt: row.attempt_at ? sqliteDate(row.attempt_at) : null,
  attemptBy: row.attempt_by,
  attemptToken: row.attempt_token,
  traceContext: row.trace_context,
});

const mapDbHeadToStateChain = (head: DbJob): StateChainInfo => ({
  id: head.id,
  typeName: head.type_name,
  status: head.chain_status as StateChainStatus,
  deduplicationKey: head.chain_deduplication_key,
  createdAt: sqliteDate(head.created_at),
  completedAt: head.chain_completed_at ? sqliteDate(head.chain_completed_at) : null,
  traceContext: head.chain_trace_context,
});

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

const mapDbWorkerToStateWorkerInfo = (row: DbWorker): StateWorkerInfo => ({
  id: row.id,
  typeNames: JSON.parse(row.type_names) as string[],
  concurrency: row.concurrency,
  startedAt: sqliteDate(row.started_at),
  leaseUntil: sqliteDate(row.lease_until),
  token: row.token,
  expired: row.expired === 1,
});

const mapDbChainRowToTailJob = (row: DbChainRow): DbJob | undefined =>
  row.tail_id
    ? (Object.fromEntries(jobColumns.map((column) => [column, row[`tail_${column}`]])) as DbJob)
    : undefined;

const mapDbChainRowToStateChain = (row: DbChainRow): StateChain => {
  const tailJob = mapDbChainRowToTailJob(row);
  return {
    ...mapDbHeadToStateChain(row),
    head: mapDbJobToStateJob(row),
    tail: tailJob ? mapDbJobToStateJob(tailJob) : undefined,
  };
};

/**
 * Create a state adapter backed by SQLite 3.42+. Returns the adapter with a `migrateToLatest()` method for schema migrations.
 *
 * @param options - SQLite state adapter configuration.
 * @throws Error if `tablePrefix`, `jobIdType` or `workerIdType` is not a valid SQL identifier.
 */
export const createSqliteStateAdapter = <
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
  TWorkerId extends string = UUID,
>({
  stateProvider,
  tablePrefix = "queuert_",
  jobIdType = "TEXT",
  workerIdType = "TEXT",
  generateJobId: generateJobIdOption,
  validateJobId: validateJobIdOption,
  generateWorkerId: generateWorkerIdOption,
  validateWorkerId: validateWorkerIdOption,
  maxBlockersPerJob: maxBlockersPerJobOption,
  countCap: countCapOption,
}: {
  /**
   * SQLite state provider wrapping the database connection. Transactions you pass to `complete`
   * or to client methods must be serialized with its `withTransaction`, for example by holding
   * the same `AsyncRwLock` write lock.
   */
  stateProvider: SqliteStateProvider<TTxContext>;
  /** Prefix for all table names. @defaultValue `"queuert_"` */
  tablePrefix?: string;
  /** SQL type of the job ID columns. @defaultValue `"TEXT"` */
  jobIdType?: string;
  /** SQL type for the worker ID columns. @defaultValue `"TEXT"` */
  workerIdType?: string;
  /**
   * Function to generate new job IDs. Must return unique values — collisions
   * are a hard error (the unique constraint rejects duplicates).
   *
   * @defaultValue `() => crypto.randomUUID()`
   */
  generateJobId?: () => TJobId;
  /**
   * Predicate returning `true` if the ID is acceptable. Core runs it on both generated
   * and caller-supplied IDs before writing; failures throw `InvalidJobIdError`.
   */
  validateJobId?: (id: TJobId) => boolean;
  /**
   * Function to generate the worker ID of a worker runner created without a `workerId`.
   * Called once per worker runner, which keeps the ID across restarts. Must return a new ID
   * on every call.
   *
   * @defaultValue `() => crypto.randomUUID()`
   */
  generateWorkerId?: () => TWorkerId;
  /**
   * Predicate returning `true` if the worker ID is acceptable. Core runs it on both generated
   * and caller-supplied worker IDs when the worker runner is created; failures throw
   * `InvalidWorkerIdError`.
   */
  validateWorkerId?: (id: TWorkerId) => boolean;
  /**
   * Most blocker chains a single job may declare. Declaring more throws
   * `BlockerLimitExceededError` before any state is written.
   *
   * @defaultValue `100`
   */
  maxBlockersPerJob?: number;
  /**
   * Per-status count at which `countChainsByTypeName` and `countJobsByTypeName` stop
   * counting and report `hasMore: true`. Higher values cost a longer index scan per count.
   *
   * @defaultValue `10_000`
   */
  countCap?: number;
}): StateAdapter<TTxContext, TJobId, TWorkerId> & {
  /**
   * Create or upgrade the schema.
   *
   * @throws Error if the driver bundles a SQLite version older than 3.42.
   * @throws Error if a 0.16 schema is found (upgrade it with `@queuert/sqlite` 0.17 first), or a
   * 0.17 migration table that records migrations 0.17 did not ship.
   */
  migrateToLatest: () => Promise<MigrationResult>;
} => {
  validateSqlIdentifier(tablePrefix, "tablePrefix");
  validateSqlIdentifier(jobIdType, "jobIdType");
  validateSqlIdentifier(workerIdType, "workerIdType");

  const closed = createLatch();

  const config = resolveStateAdapterConfig<TJobId, TWorkerId>({
    generateJobId: generateJobIdOption,
    validateJobId: validateJobIdOption,
    generateWorkerId: generateWorkerIdOption,
    validateWorkerId: validateWorkerIdOption,
    maxBlockersPerJob: maxBlockersPerJobOption,
    countCap: countCapOption,
  });
  const { countCap } = config;

  const fenceTable = `${tablePrefix}schema_fence_v${SCHEMA_VERSION}`;
  const applyTemplate = createTemplateApplier(
    {
      table_prefix: tablePrefix,
      job_id_type: jobIdType,
      worker_id_type: workerIdType,
      fence_table: fenceTable,
      migration_table: `${tablePrefix}migration`,
      write_lock_table: `${tablePrefix}write_lock`,
    },
    {
      job_columns: jobColumnsSelect,
      job_columns_prefixed: jobColumnsPrefixedSelect,
      chain_columns: chainColumnsSelect,
    },
  );

  const templateCache = createTemplateCache();

  const prepared = <
    const TParams extends readonly DataType[] = readonly [],
    const TColumns extends Record<string, DataType> = Record<string, never>,
  >(
    id: string,
    text: string,
    types: { params?: TParams; columns?: TColumns; readOnly?: boolean } = {},
  ): TypedSql<TParams, TColumns> =>
    templateCache.getOrCompute(id, () => applyTemplate(sql(text, { id, ...types })));

  const dynamic = <const TColumns extends Record<string, DataType>>(
    text: string,
    types: { params: DataType[]; columns: TColumns; readOnly: boolean },
  ): TypedSql<DataType[], TColumns> => applyTemplate(sql(text, types));

  const execute = async <
    TParams extends readonly DataType[],
    TColumns extends Record<string, DataType>,
  >(
    txCtx: TTxContext | undefined,
    typedSql: TypedSql<TParams, TColumns>,
    params?: InferParams<TParams>,
  ): Promise<InferColumns<TColumns>[]> => {
    try {
      return (await stateProvider.executeSql({
        txCtx,
        id: typedSql.id,
        sql: typedSql.sql,
        params: (params ?? []) as unknown[],
        paramTypes: extractParamTypes(typedSql.params),
        columnTypes: extractColumnTypes(typedSql.columns),
        readOnly: typedSql.readOnly,
      })) as InferColumns<TColumns>[];
    } catch (error) {
      const classified = stateProvider.classifyError({ error });
      if (
        classified?.kind === "undefined_table" &&
        classified.tableName.toLowerCase() === fenceTable.toLowerCase()
      ) {
        throw new SchemaFencedError(
          `Write fenced: the schema has no write fence of version ${SCHEMA_VERSION}. A newer schema dropped it, or migrateToLatest() has not run yet`,
          { codeVersion: SCHEMA_VERSION, cause: error },
        );
      }
      throw error;
    }
  };

  const assertServerSupported = async (): Promise<void> => {
    const [row] = await execute(
      undefined,
      prepared("serverVersion", "SELECT sqlite_version() AS version", {
        columns: { version: t.string() },
        readOnly: true,
      }),
    );
    if (!isVersionAtLeast(row.version, MIN_SQLITE_VERSION)) {
      throw new Error(
        `Unsupported SQLite version ${row.version}: Queuert needs ${MIN_SQLITE_VERSION} or later`,
      );
    }
  };

  const takeWriteLock = async (txCtx: TTxContext): Promise<void> => {
    await execute(
      txCtx,
      templateCache.getOrCompute("takeWriteLock", () => applyTemplate(takeWriteLockStatement)),
    );
  };

  const close = async (): Promise<void> => {
    if (!closed.trip()) return;
    await stateProvider.close?.();
  };

  return {
    config,

    withTransaction: stateProvider.withTransaction,

    isTransaction: stateProvider.isTransaction,

    onTransactionCommit: (txCtx, callback) => {
      stateProvider.onTransactionCommit(txCtx, callback);
    },

    onTransactionRollback: (txCtx, callback) => {
      stateProvider.onTransactionRollback(txCtx, callback);
    },

    getChains: async ({
      txCtx,
      chainIds,
      lock,
    }: {
      txCtx?: TTxContext;
      chainIds: TJobId[];
      lock?: "exclusive";
    }) => {
      if (chainIds.length === 0) return [];
      const idsJson = JSON.stringify(chainIds);
      if (lock === "exclusive" && txCtx) {
        await takeWriteLock(txCtx);
      }
      const rows = await execute(
        txCtx,
        prepared(
          "getChains",
          `
SELECT
  {{job_columns:head_job}},
  {{job_columns_prefixed:tail_job:tail_}}
FROM {{table_prefix}}job AS head_job${tailJoin("head_job")}
WHERE head_job.id IN (SELECT value FROM json_each(?))
  AND head_job.chain_index = 0
ORDER BY head_job.id
`,
          { params: [t.string()], columns: { ...dbChainRowColumns }, readOnly: true },
        ),
        [idsJson],
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      return chainIds.map((chainId) => {
        const row = byId.get(chainId);
        return row ? mapDbChainRowToStateChain(row) : undefined;
      });
    },

    getJobs: async ({
      txCtx,
      jobIds,
      lock,
    }: {
      txCtx?: TTxContext;
      jobIds: TJobId[];
      lock?: "exclusive";
    }) => {
      if (jobIds.length === 0) return [];
      const idsJson = JSON.stringify(jobIds);
      if (lock === "exclusive" && txCtx) {
        await takeWriteLock(txCtx);
      }
      const rows = await execute(
        txCtx,
        prepared(
          "getJobs",
          `
SELECT {{job_columns:j}}, {{chain_columns:h}}
FROM {{table_prefix}}job j
JOIN {{table_prefix}}job h ON h.id = j.chain_id
WHERE j.id IN (SELECT value FROM json_each(?))
`,
          {
            params: [t.string()],
            columns: { ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          },
        ),
        [idsJson],
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      return jobIds.map((jobId) => {
        const row = byId.get(jobId);
        return row ? mapDbJobRowToStateJob(row) : undefined;
      });
    },

    getWorkers: async ({
      txCtx,
      workerIds,
      lock,
    }: {
      txCtx?: TTxContext;
      workerIds: TWorkerId[];
      lock?: "exclusive";
    }) => {
      if (workerIds.length === 0) return [];
      const idsJson = JSON.stringify(workerIds);
      if (lock === "exclusive" && txCtx) {
        await takeWriteLock(txCtx);
      }
      const rows = await execute(
        txCtx,
        prepared(
          "getWorkers",
          `
SELECT *, lease_until <= datetime('now', 'subsec') AS expired
FROM {{table_prefix}}worker
WHERE id IN (SELECT value FROM json_each(?))
`,
          { params: [t.string()], columns: dbWorkerColumns, readOnly: true },
        ),
        [idsJson],
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      return workerIds.map((workerId) => {
        const row = byId.get(workerId);
        return row ? mapDbWorkerToStateWorkerInfo(row) : undefined;
      });
    },

    createJobs: async ({ txCtx, jobs }) => {
      const results: (StateChain & { deduplicated: boolean })[] = Array.from({
        length: jobs.length,
      });
      const toInsert: {
        index: number;
        id: string;
        json: Record<string, unknown>;
      }[] = [];
      const firstIndexByBatchKey = new Map<string, number>();
      const deferredDuplicates: { index: number; firstIndex: number }[] = [];

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const { typeName, id: newId, input, schedule, chainTraceContext, traceContext } = job;

        if (job.deduplication?.key) {
          const deduplicationKey = job.deduplication.key;
          const deduplicationScope = job.deduplication.scope;

          const batchKey = `${deduplicationKey}\0${job.typeName}`;
          const firstIndex = firstIndexByBatchKey.get(batchKey);
          if (firstIndex !== undefined) {
            deferredDuplicates.push({ index: i, firstIndex });
            continue;
          }

          const [existingDeduplicated] = await execute(
            txCtx,
            prepared(
              "findDeduplicatedJob",
              `
SELECT
  {{job_columns:head_job}},
  {{job_columns_prefixed:tail_job:tail_}}
FROM {{table_prefix}}job AS head_job INDEXED BY {{table_prefix}}chain_deduplication_idx${tailJoin("head_job")}
WHERE ? IS NOT NULL
  AND head_job.chain_deduplication_key = ?
  AND head_job.chain_index = 0
  AND head_job.type_name = ?
  AND (
    (? = 'running' AND head_job.chain_status = 'running')
    OR (? = 'any')
  )
ORDER BY head_job.created_at DESC
LIMIT 1
`,
              {
                params: [
                  t["string?"](),
                  t["string?"](),
                  t.string(),
                  t["string?"](),
                  t["string?"](),
                ],
                columns: { ...dbChainRowColumns },
                readOnly: true,
              },
            ),
            [
              deduplicationKey,
              deduplicationKey,
              job.typeName,
              deduplicationScope,
              deduplicationScope,
            ],
          );

          if (existingDeduplicated) {
            results[i] = {
              ...mapDbChainRowToStateChain(existingDeduplicated),
              deduplicated: true,
            };
            continue;
          }

          firstIndexByBatchKey.set(batchKey, i);
        }

        toInsert.push({
          index: i,
          id: newId,
          json: {
            id: newId,
            type_name: typeName,
            input: input !== undefined ? JSON.stringify(input) : null,
            chain_deduplication_key: job.deduplication?.key ?? null,
            scheduled_at: schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null,
            schedule_after_ms: schedule?.afterMs ?? null,
            chain_trace_context: chainTraceContext ?? null,
            trace_context: traceContext ?? null,
          },
        });
      }

      if (toInsert.length > 0) {
        const insertedRows = await execute(
          txCtx,
          prepared(
            "insertChains",
            `
WITH input_data AS (
  SELECT
    je.key                                              AS ord,
    json_extract(je.value, '$.id')                      AS new_id,
    json_extract(je.value, '$.type_name')               AS type_name,
    json_extract(je.value, '$.input')                   AS input,
    json_extract(je.value, '$.chain_deduplication_key') AS chain_deduplication_key,
    json_extract(je.value, '$.scheduled_at')            AS scheduled_at_input,
    json_extract(je.value, '$.schedule_after_ms')       AS schedule_after_ms_input,
    json_extract(je.value, '$.chain_trace_context')     AS chain_trace_context,
    json_extract(je.value, '$.trace_context')           AS trace_context
  FROM json_each(?) AS je
)
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_index, chain_status, input, chain_deduplication_key, scheduled_at, chain_trace_context, trace_context)
SELECT
  d.new_id,
  d.type_name,
  d.new_id,
  0,
  'running',
  d.input,
  d.chain_deduplication_key,
  MAX(
    COALESCE(
      d.scheduled_at_input,
      CASE WHEN d.schedule_after_ms_input IS NOT NULL
        THEN datetime('now', 'subsec', '+' || (d.schedule_after_ms_input / 1000.0) || ' seconds')
        ELSE NULL
      END,
      datetime('now', 'subsec')
    ),
    datetime('now', 'subsec')
  ),
  d.chain_trace_context,
  d.trace_context
FROM input_data d
WHERE ${FENCE_GUARD}
ORDER BY d.ord
RETURNING *
`,
            { params: [t.string()], columns: { ...dbJobColumns } },
          ),
          [JSON.stringify(toInsert.map((item) => item.json))],
        );

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

      for (const { index, firstIndex } of deferredDuplicates) {
        results[index] = { ...results[firstIndex], deduplicated: true };
      }

      return results;
    },

    continueJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];

      const entries = jobs.map((job) => ({
        new_id: job.id,
        type_name: job.typeName,
        input: job.input !== undefined ? JSON.stringify(job.input) : null,
        scheduled_at: job.schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null,
        schedule_after_ms: job.schedule?.afterMs ?? null,
        trace_context: job.traceContext ?? null,
        continue_from_id: job.continueFromId as string,
        attempt_token: job.attemptToken ?? null,
        worker_id: job.workerId ?? null,
      }));
      const payload = JSON.stringify(entries);

      const insertedRows = await execute(
        txCtx,
        prepared(
          "insertContinuations",
          `
WITH input_data AS (
  SELECT
    je.key                                              AS ord,
    json_extract(je.value, '$.new_id')                  AS new_id,
    json_extract(je.value, '$.type_name')               AS type_name,
    json_extract(je.value, '$.input')                   AS input,
    json_extract(je.value, '$.scheduled_at')            AS scheduled_at_input,
    json_extract(je.value, '$.schedule_after_ms')       AS schedule_after_ms_input,
    json_extract(je.value, '$.trace_context')           AS trace_context,
    json_extract(je.value, '$.continue_from_id')        AS continue_from_id,
    json_extract(je.value, '$.attempt_token') AS attempt_token
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
      d.scheduled_at_input,
      CASE WHEN d.schedule_after_ms_input IS NOT NULL
        THEN datetime('now', 'subsec', '+' || (d.schedule_after_ms_input / 1000.0) || ' seconds')
        ELSE NULL
      END,
      datetime('now', 'subsec')
    ),
    datetime('now', 'subsec')
  ),
  d.trace_context
FROM input_data d
JOIN {{table_prefix}}job p ON p.id = d.continue_from_id AND p.status <> 'completed'
WHERE (d.attempt_token IS NULL
  OR (p.status = 'running' AND p.attempt_token = d.attempt_token))
  AND ${FENCE_GUARD}
ORDER BY d.ord
RETURNING *
`,
          { params: [t.string()], columns: { ...dbJobColumns } },
        ),
        [payload],
      );

      const completedRows = await execute(
        txCtx,
        prepared(
          "completeContinuedJobs",
          `
WITH input_data AS (
  SELECT
    json_extract(je.value, '$.new_id')           AS new_id,
    json_extract(je.value, '$.continue_from_id') AS continue_from_id,
    json_extract(je.value, '$.attempt_token') AS attempt_token,
    json_extract(je.value, '$.worker_id') AS worker_id
  FROM json_each(?) AS je
)
UPDATE {{table_prefix}}job
SET status = 'completed',
  completed_at = datetime('now', 'subsec'),
  completed_by = d.worker_id,
  continued_to_id = d.new_id,
  output = NULL,
  last_attempt_error = NULL,
  attempt_at = NULL,
  attempt_by = NULL,
  attempt_token = NULL
FROM input_data d
WHERE {{table_prefix}}job.id = d.continue_from_id
  AND {{table_prefix}}job.status <> 'completed'
  AND {{table_prefix}}job.id NOT IN (SELECT new_id FROM input_data)
  AND (
    d.attempt_token IS NULL
    OR ({{table_prefix}}job.status = 'running' AND {{table_prefix}}job.attempt_token = d.attempt_token)
  )
  AND ${FENCE_GUARD}
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
          { params: [t.string()], columns: { ...dbJobColumns, ...dbChainColumns } },
        ),
        [payload],
      );

      const insertedById = new Map(insertedRows.map((row) => [row.id, row]));
      const completedById = new Map(completedRows.map((row) => [row.id, row]));

      return entries.map((entry) => {
        const completedRow = completedById.get(entry.continue_from_id);
        if (!completedRow) return undefined;
        return {
          ...mapDbJobRowToStateJob(completedRow),
          continuation: mapDbJobToStateJob(insertedById.get(entry.new_id)!),
        };
      });
    },

    completeJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];

      const entries = jobs.map((job) => ({
        job_id: job.jobId as string,
        output: job.output !== undefined ? JSON.stringify(job.output) : null,
        attempt_token: job.attemptToken ?? null,
        worker_id: job.workerId ?? null,
      }));
      const payload = JSON.stringify(entries);

      const rows = await execute(
        txCtx,
        prepared(
          "completeJobs",
          `
WITH input_data AS (
  SELECT
    json_extract(je.value, '$.job_id')          AS job_id,
    json_extract(je.value, '$.output')          AS output,
    json_extract(je.value, '$.attempt_token') AS attempt_token,
    json_extract(je.value, '$.worker_id') AS worker_id
  FROM json_each(?) AS je
),
targets AS (
  SELECT d.job_id, d.output, d.worker_id, j.chain_id
  FROM input_data d
  JOIN {{table_prefix}}job j ON j.id = d.job_id AND j.status <> 'completed'
  WHERE d.attempt_token IS NULL
    OR (j.status = 'running' AND j.attempt_token = d.attempt_token)
),
row_effects AS (
  SELECT
    ids.id,
    (SELECT tg.output FROM targets tg WHERE tg.job_id = ids.id) AS output,
    (SELECT tg.worker_id FROM targets tg WHERE tg.job_id = ids.id) AS completed_by,
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
  attempt_token = CASE WHEN e.completes_job THEN NULL ELSE {{table_prefix}}job.attempt_token END,
  completed_at = CASE WHEN e.completes_job THEN datetime('now', 'subsec') ELSE {{table_prefix}}job.completed_at END,
  completed_by = CASE WHEN e.completes_job THEN e.completed_by ELSE {{table_prefix}}job.completed_by END,
  output = CASE WHEN e.completes_job THEN e.output ELSE {{table_prefix}}job.output END,
  chain_status = CASE WHEN e.completes_chain THEN 'completed' ELSE {{table_prefix}}job.chain_status END,
  chain_completed_at = CASE WHEN e.completes_chain AND {{table_prefix}}job.chain_completed_at IS NULL
                            THEN datetime('now', 'subsec') ELSE {{table_prefix}}job.chain_completed_at END
FROM row_effects e
WHERE {{table_prefix}}job.id = e.id
  AND ${FENCE_GUARD}
RETURNING *
`,
          { params: [t.string()], columns: { ...dbJobColumns } },
        ),
        [payload],
      );

      const rowById = new Map(rows.map((row) => [row.id, row]));

      return jobs.map((job) => {
        const row = rowById.get(job.jobId);
        if (!row) return undefined;
        return {
          ...mapDbJobToStateJob(row),
          chain: mapDbHeadToStateChain(rowById.get(row.chain_id)!),
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
        attempt_token: job.attemptToken ?? null,
      }));
      const payload = JSON.stringify(entries);
      const rows = await execute(
        txCtx,
        prepared(
          "rescheduleJobs",
          `
WITH input_data AS (
  SELECT
    json_extract(je.value, '$.job_id')  AS job_id,
    json_extract(je.value, '$.at')       AS at,
    json_extract(je.value, '$.after_ms') AS after_ms,
    json_extract(je.value, '$.error')    AS error,
    json_extract(je.value, '$.attempt_token') AS attempt_token
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
  attempt_token = NULL
FROM input_data d
WHERE {{table_prefix}}job.id = d.job_id
  AND {{table_prefix}}job.status <> 'completed'
  AND (
    d.attempt_token IS NULL
    OR ({{table_prefix}}job.status = 'running' AND {{table_prefix}}job.attempt_token = d.attempt_token)
  )
  AND ${FENCE_GUARD}
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
          { params: [t.string()], columns: { ...dbJobColumns, ...dbChainColumns } },
        ),
        [payload],
      );
      const rowById = new Map(rows.map((row) => [row.id, row]));
      return jobs.map((job) => {
        const row = rowById.get(job.jobId);
        return row ? mapDbJobRowToStateJob(row) : undefined;
      });
    },

    deleteChains: async ({ txCtx, chainIds }) => {
      if (chainIds.length === 0) return [];

      const chainIdsJson = JSON.stringify(chainIds);

      const chainRows = await execute(
        txCtx,
        prepared(
          "getChainsByChainIds",
          `
SELECT
  {{job_columns:head_job}},
  {{job_columns_prefixed:tail_job:tail_}}
FROM {{table_prefix}}job AS head_job${tailJoin("head_job")}
WHERE head_job.id IN (SELECT value FROM json_each(?))
  AND head_job.chain_index = 0
`,
          { params: [t.string()], columns: { ...dbChainRowColumns }, readOnly: true },
        ),
        [chainIdsJson],
      );
      const chainRowById = new Map(chainRows.map((row) => [row.id, row]));

      const blockerRefRows = await execute(
        txCtx,
        prepared(
          "getExternalBlockerDetails",
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
            params: [t.string(), t.string()],
            columns: { ...dbBlockerColumns, ...dbJobColumns },
            readOnly: true,
          },
        ),
        [chainIdsJson, chainIdsJson],
      );

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

      const referenced = blockersByChain.size > 0;
      const chainsToDelete = referenced
        ? []
        : chainIds.filter((id) => chainRowById.has(id as string));

      if (chainsToDelete.length > 0) {
        const deleteJson = JSON.stringify(chainsToDelete);
        await execute(
          txCtx,
          prepared(
            "deleteBlockersByChainIds",
            `
DELETE FROM {{table_prefix}}job_blocker
WHERE job_id IN (
  SELECT id FROM {{table_prefix}}job
  WHERE (id IN (SELECT value FROM json_each(?)) AND chain_index = 0)
     OR (chain_id IN (SELECT value FROM json_each(?)) AND chain_index > 0)
)
`,
            { params: [t.string(), t.string()], columns: {} },
          ),
          [deleteJson, deleteJson],
        );
        await execute(
          txCtx,
          prepared(
            "deleteChains",
            `
DELETE FROM {{table_prefix}}job
WHERE (id IN (SELECT value FROM json_each(?)) AND chain_index = 0)
   OR (chain_id IN (SELECT value FROM json_each(?)) AND chain_index > 0)
`,
            { params: [t.string(), t.string()], columns: {} },
          ),
          [deleteJson, deleteJson],
        );
      }

      return chainIds.map((chainId) => {
        const blockers = blockersByChain.get(chainId);
        if (blockers) return blockers;
        if (referenced) return undefined;
        const row = chainRowById.get(chainId);
        if (!row) return undefined;
        return mapDbChainRowToStateChain(row);
      });
    },

    startJobAttempts: async ({ txCtx, typeNames, workerId, workerToken, limit }) => {
      const results = await execute(
        txCtx,
        prepared(
          "startJobAttempts",
          `
UPDATE {{table_prefix}}job
SET status = 'running',
  attempt = attempt + 1,
  attempt_at = datetime('now', 'subsec'),
  attempt_by = ?,
  attempt_token = lower(hex(randomblob(16)))
WHERE EXISTS (
    SELECT 1 FROM {{table_prefix}}worker
    WHERE id = ?
      AND token = ?
      AND lease_until > datetime('now', 'subsec')
  )
  AND id IN (
    SELECT id
    FROM {{table_prefix}}job INDEXED BY {{table_prefix}}job_pending_idx
    WHERE type_name IN (SELECT value FROM json_each(?))
      AND status = 'pending'
      AND scheduled_at <= datetime('now', 'subsec')
    ORDER BY scheduled_at ASC
    LIMIT CAST(? AS INTEGER)
  )
  AND ${FENCE_GUARD}
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}, EXISTS (
  SELECT 1 FROM {{table_prefix}}job_blocker jb WHERE jb.job_id = {{table_prefix}}job.id
) AS has_blockers
`,
          {
            params: [t.string(), t.string(), t.string(), t.string(), t.number()],
            columns: { ...dbJobColumns, ...dbChainColumns, has_blockers: t.number() },
          },
        ),
        [workerId, workerId, workerToken, JSON.stringify(typeNames), limit],
      );

      return results.map((result) => ({
        ...mapDbJobRowToStateJob(result),
        hasBlockers: result.has_blockers === 1,
      }));
    },
    getStartAttemptDelayMs: async ({ txCtx, typeNames }) => {
      const [result] = await execute(
        txCtx,
        prepared(
          "getStartAttemptDelayMs",
          `
SELECT
  MAX(0, CAST((julianday(job.scheduled_at) - julianday(datetime('now', 'subsec'))) * 86400000 AS INTEGER)) AS delay_ms
FROM {{table_prefix}}job as job INDEXED BY {{table_prefix}}job_pending_idx
WHERE job.type_name IN (SELECT value FROM json_each(?))
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
`,
          { params: [t.string()], columns: { delay_ms: t.number() }, readOnly: true },
        ),
        [JSON.stringify(typeNames)],
      );
      return result ? result.delay_ms : null;
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

      await execute(
        txCtx,
        prepared(
          "insertJobBlockers",
          `
INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT
  json_extract(je.value, '$.job_id'),
  json_extract(je.value, '$.blocked_by_chain_id'),
  json_extract(je.value, '$.index'),
  json_extract(je.value, '$.trace_context')
FROM json_each(?) AS je
WHERE EXISTS (
  SELECT 1 FROM {{table_prefix}}job h
  WHERE h.id = json_extract(je.value, '$.blocked_by_chain_id') AND h.chain_index = 0
)
  AND ${FENCE_GUARD}
`,
          { params: [t.string()], columns: {} },
        ),
        [payload],
      );

      const blockerRows = await execute(
        txCtx,
        prepared(
          "getBlockerChains",
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
            params: [t.string()],
            columns: { ord: t.number(), blocked_by_chain_id: idDataType, ...dbChainColumns },
            readOnly: true,
          },
        ),
        [payload],
      );

      const blockerChains: (StateChainInfo | undefined)[] = blockerRows.map((row) => {
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
        const updated = await execute(
          txCtx,
          prepared(
            "updateJobsToBlocked",
            `
UPDATE {{table_prefix}}job
SET status = 'blocked'
WHERE id IN (SELECT value FROM json_each(?))
  AND status = 'pending'
  AND ${FENCE_GUARD}
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
            { params: [t.string()], columns: { ...dbJobColumns, ...dbChainColumns } },
          ),
          [JSON.stringify([...jobIdsToBlock])],
        );
        for (const row of updated) jobRowById.set(row.id, row);
      }

      const remainingJobIds = [...blockersByJobId.keys()].filter((id) => !jobRowById.has(id));
      if (remainingJobIds.length > 0) {
        const remaining = await execute(
          txCtx,
          prepared(
            "getJobsForBlockers",
            /* sql */ `SELECT {{job_columns:j}}, {{chain_columns:h}} FROM {{table_prefix}}job j JOIN {{table_prefix}}job h ON h.id = j.chain_id WHERE j.id IN (SELECT value FROM json_each(?))`,
            {
              params: [t.string()],
              columns: { ...dbJobColumns, ...dbChainColumns },
              readOnly: true,
            },
          ),
          [JSON.stringify(remainingJobIds)],
        );
        for (const row of remaining) jobRowById.set(row.id, row);
      }

      return jobBlockers.map(({ jobId }) => ({
        ...mapDbJobRowToStateJob(jobRowById.get(jobId as string)!),
        blockers: blockersByJobId.get(jobId as string) ?? [],
      }));
    },

    getJobBlockers: async ({ txCtx, jobId }) => {
      const rows = await execute(
        txCtx,
        prepared(
          "getJobBlockers",
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
          { params: [idDataType], columns: { ...dbChainRowColumns }, readOnly: true },
        ),
        [jobId],
      );

      return rows.map(mapDbChainRowToStateChain);
    },

    unblockJobs: async ({ txCtx, blockedByChainId }) => {
      const [dependents] = await execute(
        txCtx,
        prepared(
          "hasChainDependents",
          `
SELECT EXISTS (
  SELECT 1 FROM {{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = ?
) AS has_dependents
`,
          { params: [idDataType], columns: { has_dependents: t.number() }, readOnly: true },
        ),
        [blockedByChainId],
      );
      if (dependents.has_dependents === 0) return [];

      await execute(
        txCtx,
        prepared(
          "scheduleBlockedJobs",
          `
UPDATE {{table_prefix}}job
SET status = 'pending',
  scheduled_at = MAX(scheduled_at, datetime('now', 'subsec'))
WHERE status = 'blocked'
  AND id IN (
    SELECT jb.job_id FROM {{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = ?
  )
  AND NOT EXISTS (
    SELECT 1
    FROM {{table_prefix}}job_blocker jb
    LEFT JOIN {{table_prefix}}job h ON h.id = jb.blocked_by_chain_id
    WHERE jb.job_id = {{table_prefix}}job.id
      AND h.chain_status IS NOT 'completed'
  )
  AND ${FENCE_GUARD}
`,
          { params: [idDataType], columns: {} },
        ),
        [blockedByChainId],
      );

      const blockerRows = await execute(
        txCtx,
        prepared(
          "getChainJobBlockersWithJobs",
          `
SELECT
  jb.job_id AS blocker_job_id,
  jb.blocked_by_chain_id AS blocker_chain_id,
  jb."index" AS blocker_index,
  jb.trace_context AS blocker_trace_context,
  {{job_columns:j}},
  {{chain_columns:h}}
FROM {{table_prefix}}job_blocker jb
JOIN {{table_prefix}}job j ON j.id = jb.job_id
JOIN {{table_prefix}}job h ON h.id = j.chain_id
WHERE jb.blocked_by_chain_id = ?
ORDER BY jb.job_id, jb."index"
`,
          {
            params: [idDataType],
            columns: { ...dbBlockerColumns, ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          },
        ),
        [blockedByChainId],
      );

      return blockerRows.map((row): StateDependentJob => ({
        jobId: row.blocker_job_id,
        blockedByChainId: row.blocker_chain_id,
        index: row.blocker_index,
        traceContext: row.blocker_trace_context,
        job: mapDbJobRowToStateJob(row),
      }));
    },

    startWorker: async ({ txCtx, workerId, typeNames, concurrency, leaseMs }) => {
      const [worker] = await execute(
        txCtx,
        prepared(
          "startWorker",
          `
INSERT INTO {{table_prefix}}worker (id, type_names, concurrency, lease_until, token)
SELECT ?, json(?), ?, datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds'), lower(hex(randomblob(16)))
WHERE ${FENCE_GUARD}
RETURNING *, lease_until <= datetime('now', 'subsec') AS expired
`,
          {
            params: [t.string(), t.string(), t.number(), t.number()],
            columns: dbWorkerColumns,
          },
        ),
        [workerId, JSON.stringify(typeNames), concurrency, leaseMs],
      );
      return mapDbWorkerToStateWorkerInfo(worker);
    },

    extendWorkerLease: async ({ txCtx, workerId, workerToken, leaseMs }) => {
      const [worker] = await execute(
        txCtx,
        prepared(
          "extendWorkerLease",
          `
UPDATE {{table_prefix}}worker
SET lease_until = datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds')
WHERE id = ?
  AND token = ?
  AND lease_until > datetime('now', 'subsec')
  AND ${FENCE_GUARD}
RETURNING *, lease_until <= datetime('now', 'subsec') AS expired
`,
          { params: [t.number(), t.string(), t.string()], columns: dbWorkerColumns },
        ),
        [leaseMs, workerId, workerToken],
      );
      return worker ? mapDbWorkerToStateWorkerInfo(worker) : undefined;
    },

    stopWorker: async ({ txCtx, workerId, workerToken }) => {
      const [worker] = await execute(
        txCtx,
        prepared(
          "stopWorker",
          `
DELETE FROM {{table_prefix}}worker
WHERE id = ?
  AND token = ?
RETURNING *, lease_until <= datetime('now', 'subsec') AS expired
`,
          { params: [t.string(), t.string()], columns: dbWorkerColumns },
        ),
        [workerId, workerToken],
      );
      return worker ? mapDbWorkerToStateWorkerInfo(worker) : undefined;
    },

    getChainTypeNames: async ({ txCtx }) => {
      const rows = await execute(
        txCtx,
        prepared(
          "getChainTypeNames",
          /* sql */ `
WITH RECURSIVE types AS (
  SELECT min(type_name) AS type_name FROM {{table_prefix}}job WHERE chain_index = 0
  UNION ALL
  SELECT (SELECT min(type_name) FROM {{table_prefix}}job WHERE chain_index = 0 AND type_name > types.type_name)
  FROM types WHERE types.type_name IS NOT NULL
)
SELECT type_name FROM types WHERE type_name IS NOT NULL
`,
          { params: [], columns: { type_name: t.string() }, readOnly: true },
        ),
      );
      return rows.map((r) => r.type_name);
    },

    getJobTypeNames: async ({ txCtx }) => {
      const rows = await execute(
        txCtx,
        prepared(
          "getJobTypeNames",
          /* sql */ `
WITH RECURSIVE types AS (
  SELECT min(type_name) AS type_name FROM {{table_prefix}}job
  UNION ALL
  SELECT (SELECT min(type_name) FROM {{table_prefix}}job WHERE type_name > types.type_name)
  FROM types WHERE types.type_name IS NOT NULL
)
SELECT type_name FROM types WHERE type_name IS NOT NULL
`,
          { params: [], columns: { type_name: t.string() }, readOnly: true },
        ),
      );
      return rows.map((r) => r.type_name);
    },

    countChainsByTypeName: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return [];

      const rows = await execute(
        txCtx,
        prepared(
          "countChainsByTypeName",
          /* sql */ `
SELECT
  je.value AS name,
  (SELECT count(*) FROM (
    SELECT 1 FROM {{table_prefix}}job
    WHERE type_name = je.value AND chain_index = 0 AND chain_status = 'running'
    LIMIT ${countCap + 1}
  )) AS running_count,
  (SELECT count(*) FROM (
    SELECT 1 FROM {{table_prefix}}job
    WHERE type_name = je.value AND chain_index = 0 AND chain_status = 'completed'
    LIMIT ${countCap + 1}
  )) AS completed_count
FROM json_each(?) AS je
`,
          {
            params: [t.string()],
            columns: {
              name: t.string(),
              running_count: t.number(),
              completed_count: t.number(),
            },
            readOnly: true,
          },
        ),
        [JSON.stringify(typeNames)],
      );

      const map = new Map(rows.map((r) => [r.name, r]));
      return typeNames.map((name) => {
        const r = map.get(name);
        if (!r)
          return {
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          };
        return {
          running: capCount(r.running_count, countCap),
          completed: capCount(r.completed_count, countCap),
        };
      });
    },

    countJobsByTypeName: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return [];

      const rows = await execute(
        txCtx,
        prepared(
          "countJobsByTypeName",
          /* sql */ `
SELECT
  je.value AS name,
  (SELECT count(*) FROM (SELECT 1 FROM {{table_prefix}}job WHERE type_name = je.value AND status = 'blocked' LIMIT ${countCap + 1})) AS blocked_count,
  (SELECT count(*) FROM (SELECT 1 FROM {{table_prefix}}job WHERE type_name = je.value AND status = 'pending' LIMIT ${countCap + 1})) AS pending_count,
  (SELECT count(*) FROM (SELECT 1 FROM {{table_prefix}}job WHERE type_name = je.value AND status = 'running' LIMIT ${countCap + 1})) AS running_count,
  (SELECT count(*) FROM (SELECT 1 FROM {{table_prefix}}job WHERE type_name = je.value AND status = 'completed' LIMIT ${countCap + 1})) AS completed_count
FROM json_each(?) AS je
`,
          {
            params: [t.string()],
            columns: {
              name: t.string(),
              blocked_count: t.number(),
              pending_count: t.number(),
              running_count: t.number(),
              completed_count: t.number(),
            },
            readOnly: true,
          },
        ),
        [JSON.stringify(typeNames)],
      );

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
          blocked: capCount(r.blocked_count, countCap),
          pending: capCount(r.pending_count, countCap),
          running: capCount(r.running_count, countCap),
          completed: capCount(r.completed_count, countCap),
        };
      });
    },

    countWorkers: async ({ txCtx }) => {
      const [row] = await execute(
        txCtx,
        prepared(
          "countWorkers",
          `
SELECT
  count(CASE WHEN lease_until > datetime('now', 'subsec') THEN 1 END) AS live,
  count(CASE WHEN lease_until <= datetime('now', 'subsec') THEN 1 END) AS expired
FROM {{table_prefix}}worker
`,
          { params: [], columns: { live: t.number(), expired: t.number() }, readOnly: true },
        ),
      );
      return { live: row.live, expired: row.expired };
    },

    countWorkersByTypeName: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return [];
      const rows = await execute(
        txCtx,
        prepared(
          "countWorkersByTypeName",
          `
SELECT
  count(CASE WHEN w.lease_until > datetime('now', 'subsec') THEN 1 END) AS live,
  count(CASE WHEN w.lease_until <= datetime('now', 'subsec') THEN 1 END) AS expired
FROM json_each(?) AS t
LEFT JOIN {{table_prefix}}worker w
  ON EXISTS (SELECT 1 FROM json_each(w.type_names) WHERE value = t.value)
GROUP BY t.key
ORDER BY t.key
`,
          {
            params: [t.string()],
            columns: { live: t.number(), expired: t.number() },
            readOnly: true,
          },
        ),
        [JSON.stringify(typeNames)],
      );
      return rows.map((row) => ({ live: row.live, expired: row.expired }));
    },

    countRunningJobsByWorkerId: async ({ txCtx, workerIds }) => {
      if (workerIds.length === 0) return [];
      const rows = await execute(
        txCtx,
        prepared(
          "countRunningJobsByWorkerId",
          `
SELECT count(j.id) AS count
FROM json_each(?) AS w
LEFT JOIN {{table_prefix}}job j
  ON j.status = 'running' AND j.attempt_by = w.value
GROUP BY w.key
ORDER BY w.key
`,
          { params: [t.string()], columns: { count: t.number() }, readOnly: true },
        ),
        [JSON.stringify(workerIds)],
      );
      return rows.map((row) => row.count);
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
      const orderColumn = orderBy === "completedAt" ? "chain_completed_at" : "created_at";
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, orderBy) : null;
      const sortDirection = orderDirection === "desc" ? "DESC" : "ASC";

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
          `NOT EXISTS (SELECT 1 FROM {{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = head_job.id)`,
        );
      } else if (independent === false) {
        conditions.push(
          `EXISTS (SELECT 1 FROM {{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = head_job.id)`,
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
        const comparison = orderDirection === "desc" ? "<" : ">";
        conditions.push(
          `(head_job.${orderColumn} ${comparison} ? OR (head_job.${orderColumn} = ? AND head_job.id ${comparison} ?))`,
        );
        params.push(cursorValue, cursorValue, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT {{job_columns:head_job}}, {{job_columns_prefixed:tail_job:tail_}} FROM (SELECT head_job.* FROM {{table_prefix}}job AS head_job WHERE ${conditions.join(" AND ")} ORDER BY head_job.${orderColumn} ${sortDirection}, head_job.id ${sortDirection} LIMIT ?) AS head_job${tailJoin("head_job")} ORDER BY head_job.${orderColumn} ${sortDirection}, head_job.id ${sortDirection}`,
          { params: paramTypes, columns: dbChainRowColumns, readOnly: true },
        ),
        params,
      );

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapDbChainRowToStateChain),
        nextCursor:
          hasMore && lastRow
            ? encodeCursor({
                type: "timestampWithId",
                sortKey: orderBy,
                value: sqliteDate(lastRow[orderColumn]!).toISOString(),
                id: lastRow.id,
              })
            : null,
      };
    },

    listJobs: async ({ txCtx, typeName, from, to, status, orderBy, orderDirection, page }) => {
      const sortColumn = {
        createdAt: "created_at",
        scheduledAt: "scheduled_at",
        completedAt: "completed_at",
        attemptAt: "attempt_at",
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
        conditions.push(`j.${sortColumn} >= ?`);
        params.push(isoToSqlite(from.toISOString()));
        paramTypes.push(t.string());
      }
      if (to) {
        conditions.push(`j.${sortColumn} <= ?`);
        params.push(isoToSqlite(to.toISOString()));
        paramTypes.push(t.string());
      }
      if (cursor) {
        const cursorValue = isoToSqlite(cursor.value);
        if (orderDirection === "desc") {
          conditions.push(`(j.${sortColumn} < ? OR (j.${sortColumn} = ? AND j.id < ?))`);
        } else {
          conditions.push(`(j.${sortColumn} > ? OR (j.${sortColumn} = ? AND j.id > ?))`);
        }
        params.push(cursorValue, cursorValue, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const sortDirection = orderDirection === "desc" ? "DESC" : "ASC";
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT {{job_columns:j}}, {{chain_columns:h}} FROM (SELECT j.* FROM {{table_prefix}}job j ${where} ORDER BY j.${sortColumn} ${sortDirection}, j.id ${sortDirection} LIMIT ?) j JOIN {{table_prefix}}job h ON h.id = j.chain_id ORDER BY j.${sortColumn} ${sortDirection}, j.id ${sortDirection}`,
          {
            params: paramTypes,
            columns: { ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          },
        ),
        params,
      );

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapDbJobRowToStateJob),
        nextCursor:
          hasMore && lastRow
            ? encodeCursor({
                type: "timestampWithId",
                sortKey: orderBy,
                value: sqliteDate(lastRow[sortColumn as keyof DbJob] as string).toISOString(),
                id: lastRow.id,
              })
            : null,
      };
    },

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeIdCursor(page.cursor) : null;
      const sortDirection = orderDirection === "asc" ? "ASC" : "DESC";
      const comparison = orderDirection === "asc" ? ">" : "<";

      const rows = await execute(
        txCtx,
        cursor
          ? dynamic(
              `WITH start_row AS (
          SELECT c.chain_index AS start_chain_index
          FROM {{table_prefix}}job c
          WHERE c.id = ? AND c.chain_id = ?
        )
        SELECT {{job_columns:j}}, {{chain_columns:h}}
        FROM {{table_prefix}}job j, start_row s, {{table_prefix}}job h
        WHERE ${chainMembers("j")}
          AND h.id = ?
          AND j.chain_index ${comparison} s.start_chain_index
        ORDER BY j.chain_index ${sortDirection}, j.id ${sortDirection}
        LIMIT ?`,
              {
                params: [idDataType, idDataType, idDataType, idDataType, idDataType, t.number()],
                columns: { ...dbJobColumns, ...dbChainColumns },
                readOnly: true,
              },
            )
          : dynamic(
              `SELECT {{job_columns:j}}, {{chain_columns:h}}
        FROM {{table_prefix}}job j, {{table_prefix}}job h
        WHERE ${chainMembers("j")}
          AND h.id = ?
        ORDER BY j.chain_index ${sortDirection}, j.id ${sortDirection}
        LIMIT ?`,
              {
                params: [idDataType, idDataType, idDataType, t.number()],
                columns: { ...dbJobColumns, ...dbChainColumns },
                readOnly: true,
              },
            ),
        cursor
          ? [cursor.id, chainId, chainId, chainId, chainId, page.limit + 1]
          : [chainId, chainId, chainId, page.limit + 1],
      );

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const chain = pageRows[0] ? mapDbChainColumns(chainId, pageRows[0]) : undefined;
      const lastRow = pageRows.at(-1);
      return {
        items: chain ? pageRows.map((row) => ({ ...mapDbJobToStateJob(row), chain })) : [],
        nextCursor: hasMore && lastRow ? encodeCursor({ type: "id", id: lastRow.id }) : null,
      };
    },

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, "createdAt") : null;
      const conditions: string[] = [
        `j.id IN (SELECT jb.job_id FROM {{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = ?)`,
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

      const sortDirection = orderDirection === "desc" ? "DESC" : "ASC";

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT {{job_columns:j}}, {{chain_columns:h}} FROM (SELECT j.* FROM {{table_prefix}}job j WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${sortDirection}, j.id ${sortDirection} LIMIT ?) j JOIN {{table_prefix}}job h ON h.id = j.chain_id ORDER BY j.created_at ${sortDirection}, j.id ${sortDirection}`,
          {
            params: paramTypes,
            columns: { ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          },
        ),
        params,
      );

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapDbJobRowToStateJob),
        nextCursor:
          hasMore && lastRow
            ? encodeCursor({
                type: "timestampWithId",
                sortKey: "createdAt",
                value: sqliteDate(lastRow.created_at).toISOString(),
                id: lastRow.id,
              })
            : null,
      };
    },

    listWorkers: async ({ txCtx, typeName, status, orderDirection, page }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, "startedAt") : null;
      const conditions: string[] = [
        "(? IS NULL OR EXISTS (SELECT 1 FROM json_each(w.type_names) WHERE value = ?))",
      ];
      const params: unknown[] = [typeName ?? null, typeName ?? null];
      const paramTypes: DataType[] = [t["string?"](), t["string?"]()];

      if (status !== undefined) {
        conditions.push(
          status === "live"
            ? "w.lease_until > datetime('now', 'subsec')"
            : "w.lease_until <= datetime('now', 'subsec')",
        );
      }
      if (cursor) {
        const cursorValue = isoToSqlite(cursor.value);
        if (orderDirection === "desc") {
          conditions.push("(w.started_at < ? OR (w.started_at = ? AND w.id < ?))");
        } else {
          conditions.push("(w.started_at > ? OR (w.started_at = ? AND w.id > ?))");
        }
        params.push(cursorValue, cursorValue, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const sortDirection = orderDirection === "desc" ? "DESC" : "ASC";

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT w.*, w.lease_until <= datetime('now', 'subsec') AS expired FROM {{table_prefix}}worker w WHERE ${conditions.join(" AND ")} ORDER BY w.started_at ${sortDirection}, w.id ${sortDirection} LIMIT ?`,
          { params: paramTypes, columns: dbWorkerColumns, readOnly: true },
        ),
        params,
      );

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapDbWorkerToStateWorkerInfo),
        nextCursor:
          hasMore && lastRow
            ? encodeCursor({
                type: "timestampWithId",
                sortKey: "startedAt",
                value: sqliteDate(lastRow.started_at).toISOString(),
                id: lastRow.id,
              })
            : null,
      };
    },

    listWorkerJobs: async ({ txCtx, workerId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, "attemptAt") : null;
      const conditions: string[] = ["j.status = 'running'", "j.attempt_by = ?"];
      const params: unknown[] = [workerId];
      const paramTypes: DataType[] = [t.string()];

      if (cursor) {
        const cursorValue = isoToSqlite(cursor.value);
        if (orderDirection === "desc") {
          conditions.push("(j.attempt_at < ? OR (j.attempt_at = ? AND j.id < ?))");
        } else {
          conditions.push("(j.attempt_at > ? OR (j.attempt_at = ? AND j.id > ?))");
        }
        params.push(cursorValue, cursorValue, cursor.id);
        paramTypes.push(t.string(), t.string(), t.string());
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const sortDirection = orderDirection === "desc" ? "DESC" : "ASC";

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT {{job_columns:j}}, {{chain_columns:h}} FROM (SELECT j.* FROM {{table_prefix}}job j WHERE ${conditions.join(" AND ")} ORDER BY j.attempt_at ${sortDirection}, j.id ${sortDirection} LIMIT ?) j JOIN {{table_prefix}}job h ON h.id = j.chain_id ORDER BY j.attempt_at ${sortDirection}, j.id ${sortDirection}`,
          {
            params: paramTypes,
            columns: { ...dbJobColumns, ...dbChainColumns },
            readOnly: true,
          },
        ),
        params,
      );

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapDbJobRowToStateJob),
        nextCursor:
          hasMore && lastRow
            ? encodeCursor({
                type: "timestampWithId",
                sortKey: "attemptAt",
                value: sqliteDate(lastRow.attempt_at!).toISOString(),
                id: lastRow.id,
              })
            : null,
      };
    },

    migrateToLatest: async () => {
      await assertServerSupported();
      const store = createMigrationStore(stateProvider, applyTemplate);
      return createMigrator({
        migrations: createSchemaMigrations(createTemplateExecutor(stateProvider, applyTemplate)),
        store,
        before: createLegacyUpgrade(stateProvider, store, applyTemplate),
      }).migrateToLatest();
    },

    close,
    [Symbol.asyncDispose]: close,
  };
};

/**
 * SQLite state adapter type. Includes `migrateToLatest` for schema migrations.
 */
export type SqliteStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
  TWorkerId extends string = UUID,
> = StateAdapter<TTxContext, TJobId, TWorkerId> & {
  /**
   * Create or upgrade the schema.
   *
   * @throws Error if the driver bundles a SQLite version older than 3.42.
   * @throws Error if a 0.16 schema is found (upgrade it with `@queuert/sqlite` 0.17 first), or a
   * 0.17 migration table that records migrations 0.17 did not ship.
   */
  migrateToLatest: () => Promise<MigrationResult>;
};
