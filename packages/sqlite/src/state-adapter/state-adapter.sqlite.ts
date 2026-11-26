import { createLatch } from "@queuert/helpers/latch";
import {
  type MaybePromise,
  type ModeResult,
  type SyncAsync,
  syncAsync,
  type Mode,
  step,
} from "@queuert/sync-async";
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
  createTypedSqlExecutor,
  extractColumnTypes,
  extractParamTypes,
  sql,
  t,
  validateSqlIdentifier,
} from "@queuert/typed-sql";
import {
  type BaseTxContext,
  SchemaFencedError,
  type StateAdapter,
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
import type {
  ProviderMode,
  ProviderTxContext,
  SqliteStateProvider,
} from "../state-provider/state-provider.sqlite.ts";

type UUID = ReturnType<typeof crypto.randomUUID>;

const jobColumns = [
  "created_at",
  "scheduled_at",
  "completed_at",
  "last_attempt_at",
  "attempt_at",
  "chain_completed_at",
  "chain_index",
  "attempt",
  "consecutive_failures",
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
  "last_reschedule_reason",
  "input",
  "output",
  "blocking",
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
    `${alias}.blocking AS c_blocking`,
  ].join(", ");

const chainColumnsReturning = (rowRef: string): string =>
  [
    ["type_name", "c_type_name"],
    ["chain_status", "c_status"],
    ["created_at", "c_created_at"],
    ["chain_completed_at", "c_completed_at"],
    ["chain_deduplication_key", "c_deduplication_key"],
    ["chain_trace_context", "c_trace_context"],
    ["blocking", "c_blocking"],
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
  consecutive_failures: t.number(),
  last_attempt_at: t["string?"](),
  last_attempt_error: t["string?"](),
  last_reschedule_reason: t["string?"](),
  attempt_at: t["string?"](),
  attempt_by: t["string?"](),
  attempt_token: t["string?"](),
  chain_status: t["string?"](),
  chain_completed_at: t["string?"](),
  chain_deduplication_key: t["string?"](),
  chain_trace_context: t["string?"](),
  trace_context: t["string?"](),
  blocking: t.number(),
} as const;

const dbChainColumns = {
  c_type_name: t["string?"](),
  c_status: t["string?"](),
  c_created_at: t["string?"](),
  c_completed_at: t["string?"](),
  c_deduplication_key: t["string?"](),
  c_trace_context: t["string?"](),
  c_blocking: t["number?"](),
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
  tail_consecutive_failures: t["number?"](),
  tail_last_attempt_at: t["string?"](),
  tail_last_attempt_error: t["string?"](),
  tail_last_reschedule_reason: t["string?"](),
  tail_attempt_at: t["string?"](),
  tail_attempt_by: t["string?"](),
  tail_attempt_token: t["string?"](),
  tail_chain_status: t["string?"](),
  tail_chain_completed_at: t["string?"](),
  tail_chain_deduplication_key: t["string?"](),
  tail_chain_trace_context: t["string?"](),
  tail_trace_context: t["string?"](),
  tail_blocking: t["number?"](),
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

const SCHEMA_VERSION = 2;

const SCHEMA_MIGRATION = "001_schema_v1";

const FENCE_GUARD = "NOT EXISTS (SELECT 1 FROM {{fence_table}} WHERE 1 = 0)";

type StatementExecutor<TTxContext, TResult> = (
  txCtx: TTxContext,
  statement: TypedSqlTemplate<readonly []>,
) => TResult;

const schemaNotRevertible = (): Error => new Error("The Queuert schema cannot be reverted.");

export function createSchemaMigrations<TTxContext>(
  execute: StatementExecutor<TTxContext, unknown>,
  mode: "sync",
): Migration<TTxContext, "sync">[];
export function createSchemaMigrations<TTxContext>(
  execute: StatementExecutor<TTxContext, Promise<unknown>>,
  mode: "async",
): Migration<TTxContext>[];
export function createSchemaMigrations<TTxContext>(
  execute: StatementExecutor<TTxContext, MaybePromise<unknown>>,
  mode: Mode,
): Migration<TTxContext, Mode>[];
export function createSchemaMigrations<TTxContext>(
  execute: StatementExecutor<TTxContext, MaybePromise<unknown>>,
  mode: Mode,
): Migration<TTxContext, Mode>[] {
  const upSchemaV1 = syncAsync(function* (txCtx: TTxContext) {
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
      yield* step(execute(txCtx, statement));
    }
  });
  const upSchemaV2 = syncAsync(function* (txCtx: TTxContext) {
    for (const statement of [
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job
  ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0`),
      sql(/* sql */ `
UPDATE {{table_prefix}}job
SET blocking = 1
WHERE chain_index = 0
  AND id IN (SELECT blocked_by_chain_id FROM {{table_prefix}}job_blocker)`),
      sql(/* sql */ `
CREATE INDEX {{table_prefix}}chain_blocking_idx
ON {{table_prefix}}job (type_name, created_at)
WHERE chain_index = 0 AND blocking = 1`),
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job ADD COLUMN last_reschedule_reason TEXT`),
      sql(/* sql */ `
ALTER TABLE {{table_prefix}}job ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0`),
      sql(/* sql */ `
UPDATE {{table_prefix}}job
SET last_attempt_error = CASE WHEN json_valid(last_attempt_error) THEN json_extract(last_attempt_error, '$') ELSE last_attempt_error END,
  consecutive_failures = 1
WHERE last_attempt_error IS NOT NULL`),
      sql(/* sql */ `
CREATE TABLE {{table_prefix}}schema_fence_v2 (id INTEGER PRIMARY KEY)`),
      sql(/* sql */ `
DROP TABLE {{table_prefix}}schema_fence_v1`),
    ]) {
      yield* step(execute(txCtx, statement));
    }
  });
  const down =
    mode === "sync"
      ? () => {
          throw schemaNotRevertible();
        }
      : async () => {
          throw schemaNotRevertible();
        };
  return [
    { name: SCHEMA_MIGRATION, up: mode === "sync" ? upSchemaV1.sync : upSchemaV1.async, down },
    {
      name: "002_schema_v2",
      up: mode === "sync" ? upSchemaV2.sync : upSchemaV2.async,
      down,
    },
  ];
}

export function createMigrationStore<
  TStateProvider extends
    | SqliteStateProvider<any, "sync">
    | SqliteStateProvider<any>
    | SqliteStateProvider<any, Mode>,
>(
  stateProvider: TStateProvider,
  applyTemplate: TemplateApplier,
): MigrationStore<ProviderTxContext<TStateProvider>, ProviderMode<TStateProvider>>;
export function createMigrationStore<TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext, Mode>,
  applyTemplate: TemplateApplier,
): MigrationStore<TTxContext, Mode> {
  return createSqliteMigrationStore({
    stateProvider,
    migrationTable: applyTemplate(sql("{{migration_table}}")).sql,
    writeLockTable: applyTemplate(sql("{{write_lock_table}}")).sql,
    lease: false,
  });
}

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
  consecutiveFailures: row.consecutive_failures,
  lastAttemptAt: row.last_attempt_at ? sqliteDate(row.last_attempt_at) : null,
  lastAttemptError: row.last_attempt_error,
  lastRescheduleReason: row.last_reschedule_reason,
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
  blocking: head.blocking === 1,
});

const mapDbChainColumns = (chainId: string, row: DbChainColumns): StateChainInfo => ({
  id: chainId,
  typeName: row.c_type_name!,
  status: row.c_status as StateChainStatus,
  deduplicationKey: row.c_deduplication_key,
  createdAt: sqliteDate(row.c_created_at!),
  completedAt: row.c_completed_at ? sqliteDate(row.c_completed_at) : null,
  traceContext: row.c_trace_context,
  blocking: row.c_blocking === 1,
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

type SqliteStateAdapterOptions<TStateProvider, TJobId extends string, TWorkerId extends string> = {
  /** SQLite state provider wrapping the database connection. */
  stateProvider: TStateProvider;
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
   * `JobBlockerLimitExceededError` before any state is written.
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
};

/**
 * Create a state adapter backed by SQLite 3.42+. Returns the adapter with a `migrateToLatest()`
 * method for schema migrations. The adapter follows the provider's mode.
 *
 * - Over a {@link SqliteStateProvider} it returns a {@link SqliteStateAdapter}. Transactions you
 *   pass to `applyJobOutcome` or to client methods must be serialized with the provider's
 *   `withTransaction`, for example by holding the same `AsyncRwLock` write lock.
 * - Over a {@link SqliteStateProvider} with `sync: true` it returns a `"sync"`
 *   {@link SqliteStateAdapter}, and every method, `migrateToLatest` included, returns its result
 *   directly. Pass `applyJobOutcome` and client methods the driver's own synchronous transaction;
 *   no lock is needed.
 *
 * The result's type follows the provider's type: type a synchronous provider as
 * `SqliteStateProvider<TTxContext, "sync">`, since a provider object whose `sync` is typed as
 * `boolean` gives an adapter typed for either mode.
 *
 * @param options - SQLite state adapter configuration.
 * @throws Error if `tablePrefix`, `jobIdType` or `workerIdType` is not a valid SQL identifier.
 */
export function createSqliteStateAdapter<
  TStateProvider extends
    | SqliteStateProvider<any, "sync">
    | SqliteStateProvider<any>
    | SqliteStateProvider<any, Mode>,
  TJobId extends string = UUID,
  TWorkerId extends string = UUID,
>(
  options: SqliteStateAdapterOptions<TStateProvider, TJobId, TWorkerId>,
): SqliteStateAdapter<
  ProviderTxContext<TStateProvider>,
  TJobId,
  TWorkerId,
  ProviderMode<TStateProvider>
>;
export function createSqliteStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TWorkerId extends string,
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
}: SqliteStateAdapterOptions<SqliteStateProvider<TTxContext, Mode>, TJobId, TWorkerId>):
  | SqliteStateAdapter<TTxContext, TJobId, TWorkerId>
  | SqliteStateAdapter<TTxContext, TJobId, TWorkerId, "sync"> {
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

  const sync = stateProvider.sync === true;
  const pick = <TArgs extends unknown[], TResult>(
    body: SyncAsync<TArgs, TResult>,
  ): ((...args: TArgs) => MaybePromise<TResult>) => (sync ? body.sync : body.async);

  const fencedError = (error: unknown): unknown => {
    const classified = stateProvider.classifyError({ error });
    if (
      classified?.kind === "undefined_table" &&
      classified.tableName.toLowerCase() === fenceTable.toLowerCase()
    ) {
      return new SchemaFencedError(
        `Write fenced: the schema has no write fence of version ${SCHEMA_VERSION}. A newer schema dropped it, or migrateToLatest() has not run yet`,
        { codeVersion: SCHEMA_VERSION, cause: error },
      );
    }
    return error;
  };
  const executeSql = syncAsync(function* (
    args: Parameters<SqliteStateProvider<TTxContext, Mode>["executeSql"]>[0],
  ) {
    try {
      return yield* step(stateProvider.executeSql(args));
    } catch (error) {
      // oxlint-disable-next-line typescript/only-throw-error -- rethrows the driver's error unless it is the fence's
      throw fencedError(error);
    }
  });

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

  const execute = <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>(
    txCtx: TTxContext | undefined,
    typedSql: TypedSql<TParams, TColumns>,
    params?: InferParams<TParams>,
  ): MaybePromise<InferColumns<TColumns>[]> =>
    pick(executeSql)({
      txCtx,
      id: typedSql.id,
      sql: typedSql.sql,
      params: (params ?? []) as unknown[],
      paramTypes: extractParamTypes(typedSql.params),
      columnTypes: extractColumnTypes(typedSql.columns),
      readOnly: typedSql.readOnly,
    }) as MaybePromise<InferColumns<TColumns>[]>;

  const takeWriteLock = (txCtx: TTxContext): MaybePromise<unknown> =>
    execute(
      txCtx,
      templateCache.getOrCompute("takeWriteLock", () => applyTemplate(takeWriteLockStatement)),
    );

  const close = syncAsync(function* () {
    if (!closed.trip()) return;
    yield* step(stateProvider.close?.());
  });

  const adapter: Omit<StateAdapter<TTxContext, TJobId, TWorkerId, Mode>, "sync" | "close"> & {
    migrateToLatest: () => MaybePromise<MigrationResult>;
  } = {
    config,

    // oxlint-disable-next-line typescript/unbound-method -- a provider's methods don't use `this`; SqliteStateProvider<…, Mode> declares them as methods only so that both provider modes are assignable to it
    withTransaction: stateProvider.withTransaction,

    // oxlint-disable-next-line typescript/unbound-method -- a provider's methods don't use `this`; SqliteStateProvider<…, Mode> declares them as methods only so that both provider modes are assignable to it
    getTransaction: stateProvider.getTransaction,

    onTransactionCommit: (txCtx, callback) => {
      stateProvider.onTransactionCommit(txCtx, callback);
    },

    onTransactionRollback: (txCtx, callback) => {
      stateProvider.onTransactionRollback(txCtx, callback);
    },

    getChains: pick(
      syncAsync(function* ({
        txCtx,
        chainIds,
        lock,
      }: {
        txCtx?: TTxContext;
        chainIds: TJobId[];
        lock?: "exclusive";
      }) {
        if (chainIds.length === 0) return [];
        const idsJson = JSON.stringify(chainIds);
        if (lock === "exclusive" && txCtx) {
          yield* step(takeWriteLock(txCtx));
        }
        const rows = yield* step(
          execute(
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
          ),
        );
        const byId = new Map(rows.map((row) => [row.id, row]));
        return chainIds.map((chainId) => {
          const row = byId.get(chainId);
          return row ? mapDbChainRowToStateChain(row) : undefined;
        });
      }),
    ),

    getChainTails: pick(
      syncAsync(function* (params: Parameters<typeof adapter.getChains>[0]) {
        const chains = yield* step(adapter.getChains(params));
        return chains.map((view): StateJob | undefined => {
          if (view === undefined) return undefined;
          const { head, tail, ...chain } = view;
          return { ...(tail ?? head), chain };
        });
      }),
    ),

    getJobs: pick(
      syncAsync(function* ({
        txCtx,
        jobIds,
        lock,
      }: {
        txCtx?: TTxContext;
        jobIds: TJobId[];
        lock?: "exclusive";
      }) {
        if (jobIds.length === 0) return [];
        const idsJson = JSON.stringify(jobIds);
        if (lock === "exclusive" && txCtx) {
          yield* step(takeWriteLock(txCtx));
        }
        const rows = yield* step(
          execute(
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
          ),
        );
        const byId = new Map(rows.map((r) => [r.id, r]));
        return jobIds.map((jobId) => {
          const row = byId.get(jobId);
          return row ? mapDbJobRowToStateJob(row) : undefined;
        });
      }),
    ),

    getWorkers: pick(
      syncAsync(function* ({
        txCtx,
        workerIds,
        lock,
      }: {
        txCtx?: TTxContext;
        workerIds: TWorkerId[];
        lock?: "exclusive";
      }) {
        if (workerIds.length === 0) return [];
        const idsJson = JSON.stringify(workerIds);
        if (lock === "exclusive" && txCtx) {
          yield* step(takeWriteLock(txCtx));
        }
        const rows = yield* step(
          execute(
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
          ),
        );
        const byId = new Map(rows.map((row) => [row.id, row]));
        return workerIds.map((workerId) => {
          const row = byId.get(workerId);
          return row ? mapDbWorkerToStateWorkerInfo(row) : undefined;
        });
      }),
    ),

    createJobs: pick(
      syncAsync(function* ({ txCtx, jobs }) {
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

        const deduplicationLookups: {
          ord: number;
          key: string;
          type_name: string;
          scope: string | null;
        }[] = [];
        for (const [ord, job] of jobs.entries()) {
          if (!job.deduplication?.key) continue;
          deduplicationLookups.push({
            ord,
            key: job.deduplication.key,
            type_name: job.typeName,
            scope: job.deduplication.scope ?? null,
          });
        }
        const deduplicatedRows =
          deduplicationLookups.length === 0
            ? []
            : yield* step(
                execute(
                  txCtx,
                  prepared(
                    "findDeduplicatedJobs",
                    `
WITH lookups AS (
  SELECT
    json_extract(je.value, '$.ord')       AS ord,
    json_extract(je.value, '$.key')       AS deduplication_key,
    json_extract(je.value, '$.type_name') AS type_name,
    json_extract(je.value, '$.scope')     AS scope
  FROM json_each(?) AS je
)
SELECT
  l.ord AS lookup_ord,
  {{job_columns:head_job}},
  {{job_columns_prefixed:tail_job:tail_}}
FROM lookups AS l
JOIN {{table_prefix}}job AS head_job ON head_job.id = (
  SELECT h.id
  FROM {{table_prefix}}job AS h INDEXED BY {{table_prefix}}chain_deduplication_idx
  WHERE h.chain_deduplication_key = l.deduplication_key
    AND h.chain_index = 0
    AND h.type_name = l.type_name
    AND (
      (l.scope = 'running' AND h.chain_status = 'running')
      OR (l.scope = 'any')
    )
  ORDER BY h.created_at DESC
  LIMIT 1
)${tailJoin("head_job")}
`,
                    {
                      params: [t.string()],
                      columns: { lookup_ord: t.number(), ...dbChainRowColumns },
                      readOnly: true,
                    },
                  ),
                  [JSON.stringify(deduplicationLookups)],
                ),
              );
        const existingDeduplicatedByIndex = new Map(
          deduplicatedRows.map((row) => [row.lookup_ord, row] as const),
        );

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          const { typeName, id: newId, input, schedule, chainTraceContext, traceContext } = job;

          if (job.deduplication?.key) {
            const deduplicationKey = job.deduplication.key;

            const batchKey = `${deduplicationKey}\0${job.typeName}`;
            const firstIndex = firstIndexByBatchKey.get(batchKey);
            if (firstIndex !== undefined) {
              deferredDuplicates.push({ index: i, firstIndex });
              continue;
            }

            const existingDeduplicated = existingDeduplicatedByIndex.get(i);

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
          const insertedRows = yield* step(
            execute(
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
            ),
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
      }),
    ),

    continueJobs: pick(
      syncAsync(function* ({ txCtx, jobs }) {
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

        const insertedRows = yield* step(
          execute(
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
          ),
        );

        const completedRows = yield* step(
          execute(
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
  consecutive_failures = 0,
  last_attempt_error = NULL,
  last_reschedule_reason = NULL,
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
          ),
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
      }),
    ),

    completeJobs: pick(
      syncAsync(function* ({ txCtx, jobs }) {
        if (jobs.length === 0) return [];

        const entries = jobs.map((job) => ({
          job_id: job.jobId as string,
          output: job.output !== undefined ? JSON.stringify(job.output) : null,
          attempt_token: job.attemptToken ?? null,
          worker_id: job.workerId ?? null,
        }));
        const payload = JSON.stringify(entries);

        const rows = yield* step(
          execute(
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
targets AS MATERIALIZED (
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
  consecutive_failures = CASE WHEN e.completes_job THEN 0 ELSE {{table_prefix}}job.consecutive_failures END,
  last_attempt_error = CASE WHEN e.completes_job THEN NULL ELSE {{table_prefix}}job.last_attempt_error END,
  last_reschedule_reason = CASE WHEN e.completes_job THEN NULL ELSE {{table_prefix}}job.last_reschedule_reason END,
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
          ),
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
      }),
    ),

    rescheduleJobs: pick(
      syncAsync(function* ({ txCtx, jobs }) {
        if (jobs.length === 0) return [];
        const entries = jobs.map((job) => ({
          job_id: job.jobId as string,
          at: job.schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null,
          after_ms: job.schedule?.afterMs ?? null,
          error: job.error ?? null,
          reason: job.reason ?? null,
          attempt_token: job.attemptToken ?? null,
        }));
        const payload = JSON.stringify(entries);
        const rows = yield* step(
          execute(
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
    json_extract(je.value, '$.reason')   AS reason,
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
  consecutive_failures = CASE WHEN {{table_prefix}}job.status = 'running' AND d.error IS NOT NULL THEN {{table_prefix}}job.consecutive_failures + 1 ELSE 0 END,
  last_attempt_error = CASE WHEN {{table_prefix}}job.status = 'running' THEN d.error ELSE last_attempt_error END,
  last_reschedule_reason = CASE WHEN {{table_prefix}}job.status = 'running' AND d.error IS NOT NULL THEN NULL ELSE d.reason END,
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
          ),
        );
        const rowById = new Map(rows.map((row) => [row.id, row]));
        return jobs.map((job) => {
          const row = rowById.get(job.jobId);
          return row ? mapDbJobRowToStateJob(row) : undefined;
        });
      }),
    ),

    deleteChains: pick(
      syncAsync(function* ({ txCtx, chainIds }) {
        if (chainIds.length === 0) return [];

        const chainIdsJson = JSON.stringify(chainIds);

        const chainRows = yield* step(
          execute(
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
          ),
        );
        const chainRowById = new Map(chainRows.map((row) => [row.id, row]));

        if (chainRows.length > 0) {
          yield* step(
            execute(
              txCtx,
              prepared(
                "clearUnreferencedBlockerHeads",
                `
WITH members AS (
  SELECT id FROM {{table_prefix}}job
  WHERE (id IN (SELECT value FROM json_each(?)) AND chain_index = 0)
     OR (chain_id IN (SELECT value FROM json_each(?)) AND chain_index > 0)
)
UPDATE {{table_prefix}}job
SET blocking = 0
WHERE blocking = 1
  AND chain_index = 0
  AND id IN (
    SELECT blocked_by_chain_id FROM {{table_prefix}}job_blocker
    WHERE job_id IN (SELECT id FROM members)
  )
  AND id NOT IN (SELECT id FROM members)
  AND NOT EXISTS (
    SELECT 1 FROM {{table_prefix}}job_blocker jb
    WHERE jb.blocked_by_chain_id = {{table_prefix}}job.id
      AND jb.job_id NOT IN (SELECT id FROM members)
  )
  AND ${FENCE_GUARD}
`,
                { params: [t.string(), t.string()], columns: {} },
              ),
              [chainIdsJson, chainIdsJson],
            ),
          );
          yield* step(
            execute(
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
  AND ${FENCE_GUARD}
`,
                { params: [t.string(), t.string()], columns: {} },
              ),
              [chainIdsJson, chainIdsJson],
            ),
          );
          yield* step(
            execute(
              txCtx,
              prepared(
                "deleteChains",
                `
DELETE FROM {{table_prefix}}job
WHERE ((id IN (SELECT value FROM json_each(?)) AND chain_index = 0)
   OR (chain_id IN (SELECT value FROM json_each(?)) AND chain_index > 0))
  AND ${FENCE_GUARD}
`,
                { params: [t.string(), t.string()], columns: {} },
              ),
              [chainIdsJson, chainIdsJson],
            ),
          );
        }

        return chainIds.map((chainId) => {
          const row = chainRowById.get(chainId);
          if (!row) return undefined;
          return { ...mapDbChainRowToStateChain(row), blocking: false };
        });
      }),
    ),

    startJobAttempts: pick(
      syncAsync(function* ({ txCtx, batchLimits, workerId, workerToken, limit }) {
        const results = yield* step(
          execute(
            txCtx,
            prepared(
              "startJobAttempts",
              `
WITH candidate_jobs AS (
  SELECT
    j.id,
    j.type_name,
    j.scheduled_at,
    (row_number() OVER (PARTITION BY j.type_name ORDER BY j.scheduled_at, j.id) - 1)
      / t.value AS batch_index
  FROM json_each(?) AS t
  JOIN {{table_prefix}}job AS j ON j.id IN (
    SELECT p.id
    FROM {{table_prefix}}job AS p INDEXED BY {{table_prefix}}job_pending_idx
    WHERE p.type_name = t.key
      AND p.status = 'pending'
      AND p.scheduled_at <= datetime('now', 'subsec')
    ORDER BY p.scheduled_at ASC
    LIMIT CAST(? AS INTEGER)
  )
),
acquired_batches AS (
  SELECT type_name, batch_index
  FROM candidate_jobs
  GROUP BY type_name, batch_index
  ORDER BY min(scheduled_at), type_name, batch_index
  LIMIT CAST(? AS INTEGER)
)
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
    SELECT c.id
    FROM candidate_jobs AS c
    JOIN acquired_batches AS b ON b.type_name = c.type_name AND b.batch_index = c.batch_index
  )
  AND ${FENCE_GUARD}
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}, EXISTS (
  SELECT 1 FROM {{table_prefix}}job_blocker jb WHERE jb.job_id = {{table_prefix}}job.id
) AS has_blockers
`,
              {
                params: [t.string(), t.number(), t.number(), t.string(), t.string(), t.string()],
                columns: { ...dbJobColumns, ...dbChainColumns, has_blockers: t.number() },
              },
            ),
            [
              JSON.stringify(batchLimits),
              limit * Math.max(1, ...Object.values(batchLimits)),
              limit,
              workerId,
              workerId,
              workerToken,
            ],
          ),
        );

        return results.map((result) => ({
          ...mapDbJobRowToStateJob(result),
          hasBlockers: result.has_blockers === 1,
        }));
      }),
    ),
    getStartAttemptDelayMs: pick(
      syncAsync(function* ({ txCtx, typeNames }) {
        const [result] = yield* step(
          execute(
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
          ),
        );
        return result ? result.delay_ms : null;
      }),
    ),
    addJobsBlockers: pick(
      syncAsync(function* ({ txCtx, jobBlockers }) {
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

        yield* step(
          execute(
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
          ),
        );

        const blockerRows = yield* step(
          execute(
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
          ),
        );

        const blockerChains: (StateChainInfo | undefined)[] = blockerRows.map((row) => {
          if (row.c_type_name === null) return undefined;
          return { ...mapDbChainColumns(row.blocked_by_chain_id, row), blocking: true };
        });
        const blockerHeadIds = new Set(rows.map((row) => row.blocked_by_chain_id));

        const blockersByJobId = new Map<string, (StateChainInfo | undefined)[]>();
        const jobIdsToBlock = new Set<string>();
        for (const [ord, row] of rows.entries()) {
          const chain = blockerChains[ord];
          const existing = blockersByJobId.get(row.job_id);
          if (existing) existing.push(chain);
          else blockersByJobId.set(row.job_id, [chain]);
          if (chain?.status === "running") jobIdsToBlock.add(row.job_id);
        }

        const jobIdsToBlockJson = JSON.stringify([...jobIdsToBlock]);
        const blockerHeadIdsJson = JSON.stringify([...blockerHeadIds]);
        const updated = yield* step(
          execute(
            txCtx,
            prepared(
              "blockJobsAndFlagBlockerHeads",
              `
UPDATE {{table_prefix}}job
SET status = CASE
    WHEN status = 'pending' AND id IN (SELECT value FROM json_each(?)) THEN 'blocked'
    ELSE status
  END,
  blocking = CASE
    WHEN chain_index = 0 AND id IN (SELECT value FROM json_each(?)) THEN 1
    ELSE blocking
  END
WHERE (
    (status = 'pending' AND id IN (SELECT value FROM json_each(?)))
    OR (chain_index = 0 AND blocking = 0 AND id IN (SELECT value FROM json_each(?)))
  )
  AND ${FENCE_GUARD}
RETURNING *, ${chainColumnsReturning("{{table_prefix}}job")}
`,
              {
                params: [t.string(), t.string(), t.string(), t.string()],
                columns: { ...dbJobColumns, ...dbChainColumns },
              },
            ),
            [jobIdsToBlockJson, blockerHeadIdsJson, jobIdsToBlockJson, blockerHeadIdsJson],
          ),
        );
        const jobRowById = new Map<string, DbJob & DbChainColumns>();
        for (const row of updated) {
          if (!blockersByJobId.has(row.id)) continue;
          jobRowById.set(
            row.id,
            blockerHeadIds.has(row.chain_id) ? { ...row, c_blocking: 1 } : row,
          );
        }

        const remainingJobIds = [...blockersByJobId.keys()].filter((id) => !jobRowById.has(id));
        if (remainingJobIds.length > 0) {
          const remaining = yield* step(
            execute(
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
            ),
          );
          for (const row of remaining) jobRowById.set(row.id, row);
        }

        return jobBlockers.map(({ jobId }) => ({
          ...mapDbJobRowToStateJob(jobRowById.get(jobId as string)!),
          blockers: blockersByJobId.get(jobId as string) ?? [],
        }));
      }),
    ),

    getJobsBlockers: pick(
      syncAsync(function* ({ txCtx, jobIds }) {
        if (jobIds.length === 0) return [];
        const rows = yield* step(
          execute(
            txCtx,
            prepared(
              "getJobsBlockers",
              `
SELECT
  b.job_id AS blocked_job_id,
  {{job_columns:head_job}},
  {{job_columns_prefixed:tail_job:tail_}}
FROM {{table_prefix}}job_blocker AS b
JOIN {{table_prefix}}job AS head_job
  ON head_job.id = b.blocked_by_chain_id${tailJoin("head_job")}
WHERE b.job_id IN (SELECT value FROM json_each(?))
ORDER BY b.job_id, b."index" ASC
`,
              {
                params: [t.string()],
                columns: { blocked_job_id: idDataType, ...dbChainRowColumns },
                readOnly: true,
              },
            ),
            [JSON.stringify(jobIds)],
          ),
        );

        const rowsByJobId = Map.groupBy(rows, (row) => row.blocked_job_id);
        return jobIds.map((jobId) => (rowsByJobId.get(jobId) ?? []).map(mapDbChainRowToStateChain));
      }),
    ),

    unblockJobs: pick(
      syncAsync(function* ({ txCtx, blockedByChainId }) {
        const [dependents] = yield* step(
          execute(
            txCtx,
            prepared(
              "hasChainDependents",
              `
SELECT EXISTS (
  SELECT 1 FROM {{table_prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = ?
) AS referenced
`,
              { params: [idDataType], columns: { referenced: t.number() }, readOnly: true },
            ),
            [blockedByChainId],
          ),
        );
        if (dependents.referenced === 0) return [];

        yield* step(
          execute(
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
          ),
        );

        const blockerRows = yield* step(
          execute(
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
          ),
        );

        return blockerRows.map((row): StateDependentJob => ({
          jobId: row.blocker_job_id,
          blockedByChainId: row.blocker_chain_id,
          index: row.blocker_index,
          traceContext: row.blocker_trace_context,
          job: mapDbJobRowToStateJob(row),
        }));
      }),
    ),

    startWorker: pick(
      syncAsync(function* ({ txCtx, workerId, typeNames, concurrency, leaseMs }) {
        const [worker] = yield* step(
          execute(
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
          ),
        );
        return mapDbWorkerToStateWorkerInfo(worker);
      }),
    ),

    extendWorkerLease: pick(
      syncAsync(function* ({ txCtx, workerId, workerToken, leaseMs }) {
        const [worker] = yield* step(
          execute(
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
          ),
        );
        return worker ? mapDbWorkerToStateWorkerInfo(worker) : undefined;
      }),
    ),

    stopWorker: pick(
      syncAsync(function* ({ txCtx, workerId, workerToken }) {
        const [worker] = yield* step(
          execute(
            txCtx,
            prepared(
              "stopWorker",
              `
DELETE FROM {{table_prefix}}worker
WHERE id = ?
  AND token = ?
  AND ${FENCE_GUARD}
RETURNING *, lease_until <= datetime('now', 'subsec') AS expired
`,
              { params: [t.string(), t.string()], columns: dbWorkerColumns },
            ),
            [workerId, workerToken],
          ),
        );
        return worker ? mapDbWorkerToStateWorkerInfo(worker) : undefined;
      }),
    ),

    getChainTypeNames: pick(
      syncAsync(function* ({ txCtx }) {
        const rows = yield* step(
          execute(
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
          ),
        );
        return rows.map((r) => r.type_name);
      }),
    ),

    getJobTypeNames: pick(
      syncAsync(function* ({ txCtx }) {
        const rows = yield* step(
          execute(
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
          ),
        );
        return rows.map((r) => r.type_name);
      }),
    ),

    countChainsByTypeName: pick(
      syncAsync(function* ({ txCtx, typeNames }) {
        if (typeNames.length === 0) return [];

        const rows = yield* step(
          execute(
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
          ),
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
      }),
    ),

    countJobsByTypeName: pick(
      syncAsync(function* ({ txCtx, typeNames }) {
        if (typeNames.length === 0) return [];

        const rows = yield* step(
          execute(
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
          ),
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
      }),
    ),

    countWorkers: pick(
      syncAsync(function* ({ txCtx }) {
        const [row] = yield* step(
          execute(
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
          ),
        );
        return { live: row.live, expired: row.expired };
      }),
    ),

    countWorkersByTypeName: pick(
      syncAsync(function* ({ txCtx, typeNames }) {
        if (typeNames.length === 0) return [];
        const rows = yield* step(
          execute(
            txCtx,
            prepared(
              "countWorkersByTypeName",
              `
WITH counts AS MATERIALIZED (
  SELECT
    wt.value AS type_name,
    count(DISTINCT CASE WHEN w.lease_until > datetime('now', 'subsec') THEN w.id END) AS live,
    count(DISTINCT CASE WHEN w.lease_until <= datetime('now', 'subsec') THEN w.id END) AS expired
  FROM {{table_prefix}}worker w, json_each(w.type_names) AS wt
  GROUP BY wt.value
)
SELECT coalesce(c.live, 0) AS live, coalesce(c.expired, 0) AS expired
FROM json_each(?) AS t
LEFT JOIN counts c ON c.type_name = t.value
ORDER BY t.key
`,
              {
                params: [t.string()],
                columns: { live: t.number(), expired: t.number() },
                readOnly: true,
              },
            ),
            [JSON.stringify(typeNames)],
          ),
        );
        return rows.map((row) => ({ live: row.live, expired: row.expired }));
      }),
    ),

    countRunningJobsByWorkerId: pick(
      syncAsync(function* ({ txCtx, workerIds }) {
        if (workerIds.length === 0) return [];
        const rows = yield* step(
          execute(
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
          ),
        );
        return rows.map((row) => row.count);
      }),
    ),

    listChains: pick(
      syncAsync(function* ({
        txCtx,
        typeName,
        blocking,
        from,
        to,
        status,
        orderBy,
        orderDirection,
        page,
      }) {
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

        if (blocking !== undefined) conditions.push(`head_job.blocking = ${blocking ? 1 : 0}`);

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

        const rows = yield* step(
          execute(
            txCtx,
            dynamic(
              `SELECT {{job_columns:head_job}}, {{job_columns_prefixed:tail_job:tail_}} FROM (SELECT head_job.* FROM {{table_prefix}}job AS head_job WHERE ${conditions.join(" AND ")} ORDER BY head_job.${orderColumn} ${sortDirection}, head_job.id ${sortDirection} LIMIT ?) AS head_job${tailJoin("head_job")} ORDER BY head_job.${orderColumn} ${sortDirection}, head_job.id ${sortDirection}`,
              { params: paramTypes, columns: dbChainRowColumns, readOnly: true },
            ),
            params,
          ),
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
      }),
    ),

    listJobs: pick(
      syncAsync(function* ({ txCtx, typeName, from, to, status, orderBy, orderDirection, page }) {
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

        const rows = yield* step(
          execute(
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
          ),
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
      }),
    ),

    listChainJobs: pick(
      syncAsync(function* ({ txCtx, chainId, orderDirection, page }) {
        const cursor = page.cursor ? decodeIdCursor(page.cursor) : null;
        const sortDirection = orderDirection === "asc" ? "ASC" : "DESC";
        const comparison = orderDirection === "asc" ? ">" : "<";

        const rows = yield* step(
          execute(
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
                    params: [
                      idDataType,
                      idDataType,
                      idDataType,
                      idDataType,
                      idDataType,
                      t.number(),
                    ],
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
          ),
        );

        const hasMore = rows.length > page.limit;
        const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
        const chain = pageRows[0] ? mapDbChainColumns(chainId, pageRows[0]) : undefined;
        const lastRow = pageRows.at(-1);
        return {
          items: chain ? pageRows.map((row) => ({ ...mapDbJobToStateJob(row), chain })) : [],
          nextCursor: hasMore && lastRow ? encodeCursor({ type: "id", id: lastRow.id }) : null,
        };
      }),
    ),

    listBlockedJobs: pick(
      syncAsync(function* ({ txCtx, chainId, orderDirection, page }) {
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

        const rows = yield* step(
          execute(
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
          ),
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
      }),
    ),

    listWorkers: pick(
      syncAsync(function* ({ txCtx, typeName, status, orderDirection, page }) {
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

        const rows = yield* step(
          execute(
            txCtx,
            dynamic(
              `SELECT w.*, w.lease_until <= datetime('now', 'subsec') AS expired FROM {{table_prefix}}worker w WHERE ${conditions.join(" AND ")} ORDER BY w.started_at ${sortDirection}, w.id ${sortDirection} LIMIT ?`,
              { params: paramTypes, columns: dbWorkerColumns, readOnly: true },
            ),
            params,
          ),
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
      }),
    ),

    listWorkerJobs: pick(
      syncAsync(function* ({ txCtx, workerId, orderDirection, page }) {
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

        const rows = yield* step(
          execute(
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
          ),
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
      }),
    ),

    migrateToLatest: pick(
      syncAsync(function* () {
        const store = createMigrationStore(stateProvider, applyTemplate);
        const exec = createTypedSqlExecutor(stateProvider);
        const migrator = createMigrator({
          mode: sync ? "sync" : "async",
          migrations: createSchemaMigrations(
            (txCtx: TTxContext, statement) => exec({ txCtx, sql: applyTemplate(statement) }),
            sync ? "sync" : "async",
          ),
          store,
        });
        return yield* step(migrator.migrateToLatest());
      }),
    ),
  };

  return sync
    ? ({
        sync: true,
        ...adapter,
        close: close.sync,
        [Symbol.dispose]: close.sync,
      } as SqliteStateAdapter<TTxContext, TJobId, TWorkerId, "sync">)
    : ({
        ...adapter,
        close: close.async,
        [Symbol.asyncDispose]: close.async,
      } as SqliteStateAdapter<TTxContext, TJobId, TWorkerId>);
}

/**
 * SQLite state adapter type. Includes `migrateToLatest` for schema migrations. In the `"sync"`
 * mode, returned over a provider with `sync: true`, every method returns its result directly.
 *
 * @typeParam TMode - Whether the methods return promises or plain values
 */
export type SqliteStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
  TWorkerId extends string = UUID,
  TMode extends Mode = "async",
> = TMode extends Mode
  ? StateAdapter<TTxContext, TJobId, TWorkerId, TMode> & {
      /**
       * Create or upgrade the schema.
       */
      migrateToLatest: () => ModeResult<TMode, MigrationResult>;
    }
  : never;
