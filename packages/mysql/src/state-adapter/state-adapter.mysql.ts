import { type UUID, randomUUID } from "node:crypto";

import { createLatch } from "@queuert/helpers/latch";
import {
  type DataType,
  type Migration,
  type MigrationResult,
  type RuntimeType,
  type TypedSql,
  createMigrator,
  createTemplateApplier,
  createTemplateCache,
  sql,
  t,
  toSqlStatement,
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

import { createMysqlMigrationStore } from "../migration-store/migration-store.mysql.ts";
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

type Row = Record<string, unknown>;

type StatementTypes = {
  params?: readonly DataType[];
  columns?: Record<string, DataType>;
  readOnly?: boolean;
};

const SCHEMA_VERSION = 2;

const SCHEMA_MIGRATION = "001_schema_v1";

const DB_JOB_COLUMNS = [
  "id",
  "type_name",
  "chain_id",
  "chain_index",
  "continued_to_id",
  "input",
  "output",
  "status",
  "created_at",
  "scheduled_at",
  "completed_at",
  "completed_by",
  "attempt",
  "consecutive_failures",
  "last_attempt_error",
  "last_reschedule_reason",
  "last_attempt_at",
  "attempt_at",
  "attempt_by",
  "attempt_token",
  "chain_status",
  "chain_completed_at",
  "chain_deduplication_key",
  "chain_trace_context",
  "trace_context",
  "blocking",
] as const;

const DB_CHAIN_COLUMNS = [
  "id",
  "type_name",
  "chain_status",
  "created_at",
  "chain_completed_at",
  "chain_deduplication_key",
  "chain_trace_context",
  "blocking",
] as const;

const DB_TEXT_CAST_COLUMNS = new Set<string>([
  "input",
  "output",
  "created_at",
  "scheduled_at",
  "completed_at",
  "last_attempt_at",
  "attempt_at",
  "chain_completed_at",
]);

const COLLATIONS = { mysql: "utf8mb4_0900_bin", mariadb: "utf8mb4_nopad_bin" } as const;

const NULLABLE_TYPES: Partial<Record<RuntimeType, DataType>> = {
  string: t["string?"](),
  number: t["number?"](),
  boolean: t["boolean?"](),
  uuid: t["uuid?"](),
  json: t["json?"](),
};

const prefixColumns = (types: Record<string, DataType>, prefix: string): Record<string, DataType> =>
  Object.fromEntries(Object.entries(types).map(([name, type]) => [`${prefix}${name}`, type]));

const nullableColumns = (types: Record<string, DataType>): Record<string, DataType> =>
  Object.fromEntries(
    Object.entries(types).map(([name, type]) => [name, NULLABLE_TYPES[type.type] ?? type]),
  );

const pickColumns = (
  types: Record<string, DataType>,
  names: readonly string[],
): Record<string, DataType> => Object.fromEntries(names.map((name) => [name, types[name]]));

const selectColumns = (columns: readonly string[], alias: string, prefix: string): string =>
  columns
    .map((column) =>
      DB_TEXT_CAST_COLUMNS.has(column)
        ? `CAST(${alias}.${column} AS CHAR) AS ${prefix}${column}`
        : `${alias}.${column} AS ${prefix}${column}`,
    )
    .join(", ");

const selectJob = (alias: string, prefix = ""): string =>
  selectColumns(DB_JOB_COLUMNS, alias, prefix);
const selectChain = (alias: string, prefix: string): string =>
  selectColumns(DB_CHAIN_COLUMNS, alias, prefix);

const selectWorker = (alias: string): string =>
  `${alias}.id, CAST(${alias}.type_names AS CHAR) AS type_names, ${alias}.concurrency, CAST(${alias}.started_at AS CHAR) AS started_at, CAST(${alias}.lease_until AS CHAR) AS lease_until, ${alias}.token, ${alias}.lease_until <= UTC_TIMESTAMP(6) AS expired`;

const formatTimestamp = (date: Date): string => date.toISOString().slice(0, 23).replace("T", " ");

const parseTimestamp = (value: unknown): Date =>
  new Date(`${String(value).slice(0, 23).replace(" ", "T")}Z`);

const parseNullableTimestamp = (value: unknown): Date | null =>
  value == null ? null : parseTimestamp(value);

const parseJson = (value: unknown): unknown =>
  value == null ? null : typeof value === "string" ? JSON.parse(value) : value;

const toBoolean = (value: unknown): boolean => Boolean(Number(value));

const toJsonParam = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (item === null ? undefined : item));

const stringifyOptional = (value: unknown): string | undefined =>
  value === undefined ? undefined : JSON.stringify(value);

const capCount = (count: unknown, countCap: number): StateCount => ({
  count: Math.min(Number(count), countCap),
  hasMore: Number(count) > countCap,
});

const compareBy =
  <T>(key: (item: T) => string) =>
  (left: T, right: T): number =>
    key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0;

const sortedIdsParam = (ids: string[]): string => JSON.stringify([...new Set(ids)].sort());

const mapDbJobToStateJobInfo = (row: Row, prefix = ""): StateJobInfo | undefined => {
  const column = (name: (typeof DB_JOB_COLUMNS)[number]): unknown => row[`${prefix}${name}`];
  if (column("id") == null) return undefined;
  return {
    id: column("id") as string,
    typeName: column("type_name") as string,
    chainId: column("chain_id") as string,
    chainIndex: Number(column("chain_index")),
    continuedToId: (column("continued_to_id") as string | null) ?? null,
    input: parseJson(column("input")),
    output: parseJson(column("output")),
    status: column("status") as StateJobStatus,
    createdAt: parseTimestamp(column("created_at")),
    scheduledAt: parseTimestamp(column("scheduled_at")),
    completedAt: parseNullableTimestamp(column("completed_at")),
    completedBy: (column("completed_by") as string | null) ?? null,
    attempt: Number(column("attempt")),
    consecutiveFailures: Number(column("consecutive_failures")),
    lastAttemptAt: parseNullableTimestamp(column("last_attempt_at")),
    lastAttemptError: (column("last_attempt_error") as string | null) ?? null,
    lastRescheduleReason: (column("last_reschedule_reason") as string | null) ?? null,
    attemptAt: parseNullableTimestamp(column("attempt_at")),
    attemptBy: (column("attempt_by") as string | null) ?? null,
    attemptToken: (column("attempt_token") as string | null) ?? null,
    traceContext: (column("trace_context") as string | null) ?? null,
  };
};

const mapDbHeadToStateChainInfo = (row: Row, prefix: string): StateChainInfo => ({
  id: row[`${prefix}id`] as string,
  typeName: row[`${prefix}type_name`] as string,
  status: row[`${prefix}chain_status`] as StateChainStatus,
  deduplicationKey: (row[`${prefix}chain_deduplication_key`] as string | null) ?? null,
  createdAt: parseTimestamp(row[`${prefix}created_at`]),
  completedAt: parseNullableTimestamp(row[`${prefix}chain_completed_at`]),
  traceContext: (row[`${prefix}chain_trace_context`] as string | null) ?? null,
  blocking: toBoolean(row[`${prefix}blocking`]),
});

const mapDbChainRowToStateChain = (row: Row): StateChain => ({
  ...mapDbHeadToStateChainInfo(row, "h_"),
  head: mapDbJobToStateJobInfo(row, "h_")!,
  tail: mapDbJobToStateJobInfo(row, "t_"),
});

const mapDbJobRowToStateJob = (row: Row): StateJob => ({
  ...mapDbJobToStateJobInfo(row)!,
  chain: mapDbHeadToStateChainInfo(row, "c_"),
});

const mapDbWorkerToStateWorkerInfo = (row: Row): StateWorkerInfo => ({
  id: row.id as string,
  typeNames: parseJson(row.type_names) as string[],
  concurrency: Number(row.concurrency),
  startedAt: parseTimestamp(row.started_at),
  leaseUntil: parseTimestamp(row.lease_until),
  token: row.token as string,
  expired: toBoolean(row.expired),
});

const mapDbBlockerRowToStateBlockedJob = <TJob extends StateJobInfo>(
  row: Row,
  job: TJob,
): Omit<StateBlockedJob, "job"> & { job: TJob } => ({
  jobId: row.b_job_id as string,
  blockedByChainId: row.b_blocked_by_chain_id as string,
  index: Number(row.b_index),
  traceContext: (row.b_trace_context as string | null) ?? null,
  job,
});

const resolveIdColumnType = (preset: string, collation: string, name: string): string => {
  if (preset === "uuid") return "CHAR(36) CHARACTER SET ascii COLLATE ascii_bin";
  const length = Number(/^varchar\((\d+)\)$/i.exec(preset)?.[1]);
  if (Number.isInteger(length) && length >= 1 && length <= 255) {
    return `VARCHAR(${length}) CHARACTER SET utf8mb4 COLLATE ${collation}`;
  }
  throw new Error(
    `Invalid ${name}: "${preset}". Expected "uuid" or "varchar(n)" with n from 1 to 255.`,
  );
};

const schemaStatements = [
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}job (
  id                            {{job_id_type}} NOT NULL,
  chain_id                      {{job_id_type}} NOT NULL,
  chain_index                   INT NOT NULL,
  continued_to_id               {{job_id_type}} NULL,
  type_name                     {{name_type}} NOT NULL,
  status                        VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  chain_status                  VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at                    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  scheduled_at                  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  completed_at                  DATETIME(6) NULL,
  last_attempt_at               DATETIME(6) NULL,
  attempt_at                    DATETIME(6) NULL,
  chain_completed_at            DATETIME(6) NULL,
  attempt                       INT NOT NULL DEFAULT 0,
  chain_deduplication_key       {{name_type}} NULL,
  chain_trace_context           TEXT NULL,
  trace_context                 TEXT NULL,
  last_attempt_error            JSON NULL,
  input                         JSON NULL,
  output                        JSON NULL,
  attempt_by                    {{worker_id_type}} NULL,
  completed_by                  {{worker_id_type}} NULL,
  attempt_token                 CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status_ts                     DATETIME(6) AS (CASE status WHEN 'running' THEN attempt_at WHEN 'completed' THEN completed_at ELSE scheduled_at END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY {{name_prefix}}chain_index_idx (chain_id, chain_index),
  KEY {{name_prefix}}job_status_idx (type_name, status, status_ts),
  KEY {{name_prefix}}job_idx (type_name, created_at),
  KEY {{name_prefix}}chain_idx (type_name, chain_index, created_at),
  KEY {{name_prefix}}chain_running_idx (type_name, chain_status, created_at),
  KEY {{name_prefix}}chain_completed_idx (type_name, chain_status, chain_completed_at),
  KEY {{name_prefix}}chain_deduplication_idx (chain_deduplication_key, type_name, chain_index, created_at),
  KEY {{name_prefix}}job_attempt_by_idx (attempt_by, status, attempt_at),
  CONSTRAINT {{name_prefix}}job_status_check CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  CONSTRAINT {{name_prefix}}job_chain_status_check CHECK (chain_status IN ('running', 'completed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}job_blocker (
  job_id                        {{job_id_type}} NOT NULL,
  blocked_by_chain_id           {{job_id_type}} NOT NULL,
  \`index\`                       INT NOT NULL,
  trace_context                 TEXT NULL,
  PRIMARY KEY (job_id, blocked_by_chain_id, \`index\`),
  KEY {{name_prefix}}job_blocker_chain_idx (blocked_by_chain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}worker (
  id                            {{worker_id_type}} NOT NULL,
  type_names                    JSON NOT NULL,
  concurrency                   INT NOT NULL,
  started_at                    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  lease_until                   DATETIME(6) NOT NULL,
  token                         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  KEY {{name_prefix}}worker_idx (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `CREATE TABLE IF NOT EXISTS {{prefix}}schema_fence_v1 (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
];

/**
 * Create a state adapter backed by MySQL 8.4+ or MariaDB 11.4+ (InnoDB). Returns the adapter
 * with a `migrateToLatest()` method for schema migrations.
 *
 * Queuert supports READ COMMITTED only: transactions the adapter opens run at READ COMMITTED, and
 * transactions passed in must run at READ COMMITTED too.
 *
 * @param options - MySQL state adapter configuration.
 * @throws Error if `schema` or `tablePrefix` is not a valid SQL identifier, or if `jobIdType` or
 * `workerIdType` is not a supported preset.
 *
 * @experimental
 */
export const createMysqlStateAdapter = <
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
  TWorkerId extends string = UUID,
>({
  stateProvider,
  dialect,
  schema,
  tablePrefix = "queuert_",
  jobIdType = "uuid",
  workerIdType = "uuid",
  generateJobId,
  validateJobId,
  generateWorkerId,
  validateWorkerId,
  maxBlockersPerJob,
  countCap: countCapOption,
}: {
  /** MySQL state provider wrapping the database connection. */
  stateProvider: MysqlStateProvider<TTxContext>;
  /** The server the adapter talks to. */
  dialect: "mysql" | "mariadb";
  /** Database that holds the tables. @defaultValue the connection's current database */
  schema?: string;
  /** Prefix for all table names. @defaultValue `"queuert_"` */
  tablePrefix?: string;
  /**
   * Job ID column preset: `"uuid"` (`CHAR(36)`, `ascii_bin`) or `"varchar(n)"` with `n` from 1 to
   * 255. @defaultValue `"uuid"`
   */
  jobIdType?: "uuid" | `varchar(${number})`;
  /**
   * Worker ID column preset: `"uuid"` (`CHAR(36)`, `ascii_bin`) or `"varchar(n)"` with `n` from 1
   * to 255. @defaultValue `"uuid"`
   */
  workerIdType?: "uuid" | `varchar(${number})`;
  /** Function to generate new job IDs. @defaultValue `() => crypto.randomUUID()` */
  generateJobId?: () => TJobId;
  /** Predicate returning `true` if the job ID is acceptable. */
  validateJobId?: (id: TJobId) => boolean;
  /** Function to generate the worker ID of a worker runner created without one. */
  generateWorkerId?: () => TWorkerId;
  /** Predicate returning `true` if the worker ID is acceptable. */
  validateWorkerId?: (id: TWorkerId) => boolean;
  /** Most blocker chains a single job may declare. @defaultValue `100` */
  maxBlockersPerJob?: number;
  /** Per-status count at which counts stop and report `hasMore`. @defaultValue `10_000` */
  countCap?: number;
}): MysqlStateAdapter<TTxContext, TJobId, TWorkerId> => {
  if (schema !== undefined) validateSqlIdentifier(schema, "schema");
  validateSqlIdentifier(tablePrefix, "tablePrefix");
  const collation = COLLATIONS[dialect];

  const closed = createLatch();
  const config = resolveStateAdapterConfig<TJobId, TWorkerId>({
    generateJobId,
    validateJobId,
    generateWorkerId,
    validateWorkerId,
    maxBlockersPerJob,
    countCap: countCapOption,
  });
  const { countCap } = config;

  const qualifiedPrefix = schema === undefined ? tablePrefix : `${schema}.${tablePrefix}`;
  const fenceTableName = `${tablePrefix}schema_fence_v${SCHEMA_VERSION}`.toLowerCase();
  const applyTemplate = createTemplateApplier(
    {
      prefix: qualifiedPrefix,
      name_prefix: tablePrefix,
      job_id_type: resolveIdColumnType(jobIdType, collation, "jobIdType"),
      worker_id_type: resolveIdColumnType(workerIdType, collation, "workerIdType"),
      name_type: `VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${collation}`,
      collation,
      fence_guard: `NOT EXISTS (SELECT 1 FROM ${qualifiedPrefix}schema_fence_v${SCHEMA_VERSION} WHERE 1 = 0)`,
    },
    {
      for_update: (...aliases: string[]) =>
        dialect === "mysql" ? `FOR UPDATE OF ${aliases.join(", ")}` : "FOR UPDATE",
    },
  );
  const templateCache = createTemplateCache();

  const prepared = (id: string, text: string, types: StatementTypes = {}): TypedSql =>
    templateCache.getOrCompute(id, () => applyTemplate(sql(text, { id, ...types })));
  const dynamic = (text: string, types: StatementTypes = {}): TypedSql =>
    applyTemplate(sql(text, { readOnly: true, ...types }));

  const jobIdDataType = jobIdType === "uuid" ? t.uuid() : t.string();
  const nullableJobIdDataType = jobIdType === "uuid" ? t["uuid?"]() : t["string?"]();
  const workerIdDataType = workerIdType === "uuid" ? t.uuid() : t.string();
  const nullableWorkerIdDataType = workerIdType === "uuid" ? t["uuid?"]() : t["string?"]();
  const dbJobColumns: Record<(typeof DB_JOB_COLUMNS)[number], DataType> = {
    id: jobIdDataType,
    type_name: t.string(),
    chain_id: jobIdDataType,
    chain_index: t.number(),
    continued_to_id: nullableJobIdDataType,
    input: t["string?"](),
    output: t["string?"](),
    status: t.string(),
    created_at: t.string(),
    scheduled_at: t.string(),
    completed_at: t["string?"](),
    completed_by: nullableWorkerIdDataType,
    attempt: t.number(),
    consecutive_failures: t.number(),
    last_attempt_error: t["string?"](),
    last_reschedule_reason: t["string?"](),
    last_attempt_at: t["string?"](),
    attempt_at: t["string?"](),
    attempt_by: nullableWorkerIdDataType,
    attempt_token: t["uuid?"](),
    chain_status: t["string?"](),
    chain_completed_at: t["string?"](),
    chain_deduplication_key: t["string?"](),
    chain_trace_context: t["string?"](),
    trace_context: t["string?"](),
    blocking: t.number(),
  };
  const dbChainColumns = prefixColumns(pickColumns(dbJobColumns, DB_CHAIN_COLUMNS), "c_");
  const dbChainRowColumns = {
    ...prefixColumns(dbJobColumns, "h_"),
    ...nullableColumns(prefixColumns(dbJobColumns, "t_")),
  };
  const dbJobRowColumns = { ...dbJobColumns, ...dbChainColumns };
  const dbWorkerColumns = {
    id: workerIdDataType,
    type_names: t.string(),
    concurrency: t.number(),
    started_at: t.string(),
    lease_until: t.string(),
    token: t.uuid(),
    expired: t.number(),
  };
  const dbBlockerColumns = {
    b_job_id: jobIdDataType,
    b_blocked_by_chain_id: jobIdDataType,
    b_index: t.number(),
    b_trace_context: t["string?"](),
  };

  const isFenceError = (error: unknown): boolean => {
    const classified = stateProvider.classifyError({ error });
    if (classified?.kind !== "undefined_table") return false;
    const tableName = classified.tableName.toLowerCase();
    return schema === undefined
      ? tableName.endsWith(`.${fenceTableName}`)
      : tableName === `${schema.toLowerCase()}.${fenceTableName}`;
  };

  const executeBatch = async (
    txCtx: TTxContext | undefined,
    statements: { sql: TypedSql; params?: unknown[] }[],
  ): Promise<Row[][]> => {
    try {
      return (await stateProvider.executeStatements({
        txCtx,
        statements: statements.map((statement) => toSqlStatement(statement.sql, statement.params)),
      })) as Row[][];
    } catch (error) {
      if (isFenceError(error)) {
        throw new SchemaFencedError(
          `Write fenced: the schema has no write fence of version ${SCHEMA_VERSION}. A newer schema dropped it, or migrateToLatest() has not run yet`,
          { codeVersion: SCHEMA_VERSION, cause: error },
        );
      }
      throw error;
    }
  };

  const execute = async (
    txCtx: TTxContext | undefined,
    typedSql: TypedSql,
    params: unknown[] = [],
  ): Promise<Row[]> => {
    const [rows] = await executeBatch(txCtx, [{ sql: typedSql, params }]);
    return rows;
  };

  const withOwnTransaction = async <T>(
    txCtx: TTxContext | undefined,
    fn: (txCtx: TTxContext) => Promise<T>,
  ): Promise<T> => (txCtx ? fn(txCtx) : stateProvider.withTransaction(fn));

  const jobIds = (alias = "id_list") =>
    `SELECT ${alias}.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) ${alias}`;
  const tailJoin = (headAlias: string, tailAlias: string) =>
    `LEFT JOIN {{prefix}}job ${tailAlias} FORCE INDEX (PRIMARY) ON ${tailAlias}.id = (SELECT tail_lookup.id FROM {{prefix}}job tail_lookup WHERE tail_lookup.chain_id = ${headAlias}.id AND tail_lookup.chain_index > 0 ORDER BY tail_lookup.chain_index DESC LIMIT 1)`;
  const stateJobSelect = `SELECT ${selectJob("j")}, ${selectChain("h", "c_")} FROM {{prefix}}job j JOIN {{prefix}}job h ON h.id = j.chain_id`;
  const scheduleExpression = (alias: string) =>
    `GREATEST(COALESCE(${alias}.scheduled_at, UTC_TIMESTAMP(6) + INTERVAL ROUND(${alias}.schedule_after_ms * 1000) MICROSECOND, UTC_TIMESTAMP(6)), UTC_TIMESTAMP(6))`;

  const getChainsStatement = (chainIds: string[]) => ({
    sql: prepared(
      "getChains",
      `SELECT ${selectJob("h", "h_")}, ${selectJob("t", "t_")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id ${tailJoin("h", "t")} WHERE h.chain_index = 0`,
      {
        params: [t.string()],
        columns: dbChainRowColumns,
        readOnly: true,
      },
    ),
    params: [JSON.stringify(chainIds)],
  });
  const mapChainRowsById = (rows: Row[]): Map<string, StateChain> =>
    new Map(rows.map((row) => [row.h_id as string, mapDbChainRowToStateChain(row)]));

  const getJobsStatement = (ids: string[]) => ({
    sql: prepared(
      "getJobs",
      `SELECT ${selectJob("j")}, ${selectChain("h", "c_")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = j.chain_id`,
      {
        params: [t.string()],
        columns: dbJobRowColumns,
        readOnly: true,
      },
    ),
    params: [JSON.stringify(ids)],
  });
  const mapJobRowsById = (rows: Row[]): Map<string, StateJob> =>
    new Map(rows.map((row) => [row.id as string, mapDbJobRowToStateJob(row)]));

  const mapLockedJobRowsById = (
    rows: Row[],
  ): Map<string, { status: string; attemptToken: string | null }> =>
    new Map(
      rows.map((row) => [
        row.id as string,
        {
          status: row.status as string,
          attemptToken: (row.attempt_token as string | null) ?? null,
        },
      ]),
    );

  const writableJobCondition = `j.status <> 'completed'
  AND (d.attempt_token IS NULL OR (j.status = 'running' AND j.attempt_token = d.attempt_token))`;

  const isWritable = (
    locked: { status: string; attemptToken: string | null } | undefined,
    attemptToken: string | undefined,
  ): boolean =>
    locked !== undefined &&
    locked.status !== "completed" &&
    (attemptToken === undefined ||
      (locked.status === "running" && locked.attemptToken === attemptToken));

  const getWorkerStatement = (workerId: string) => ({
    sql: prepared(
      "getWorker",
      `SELECT ${selectWorker("w")} FROM {{prefix}}worker w WHERE w.id = ?`,
      {
        params: [workerIdDataType],
        columns: dbWorkerColumns,
      },
    ),
    params: [workerId],
  });

  const createSchemaMigrations = (): Migration<TTxContext>[] => [
    {
      name: SCHEMA_MIGRATION,
      type: "non-transactional",
      up: async () => {
        for (const statement of schemaStatements) {
          await execute(undefined, applyTemplate(sql(statement)));
        }
      },
      down: async () => {
        throw new Error("The Queuert schema cannot be reverted.");
      },
    },
    {
      name: "002_schema_v2",
      type: "non-transactional",
      up: async () => {
        const hasJobColumn = async (name: string): Promise<boolean> => {
          const [column] = await execute(
            undefined,
            applyTemplate(
              sql(
                `SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ${schema === undefined ? "DATABASE()" : `'${schema}'`} AND table_name = '{{name_prefix}}job' AND column_name = '${name}'`,
                { columns: { count: t.number() } },
              ),
            ),
            [],
          );
          return Number(column.count) > 0;
        };
        for (const [columnName, definition] of [
          ["blocking", "BOOLEAN NOT NULL DEFAULT FALSE"],
          ["blockers_remaining", "INT NOT NULL DEFAULT 0"],
        ]) {
          if (!(await hasJobColumn(columnName))) {
            await execute(
              undefined,
              applyTemplate(
                sql(`ALTER TABLE {{prefix}}job ADD COLUMN ${columnName} ${definition}`),
              ),
              [],
            );
          }
        }
        const [index] = await execute(
          undefined,
          applyTemplate(
            sql(
              `SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = ${schema === undefined ? "DATABASE()" : `'${schema}'`} AND table_name = '{{name_prefix}}job' AND index_name = '{{name_prefix}}chain_blocking_idx'`,
              { columns: { count: t.number() } },
            ),
          ),
          [],
        );
        if (Number(index.count) === 0) {
          await execute(
            undefined,
            applyTemplate(
              sql(
                /* sql */ `CREATE INDEX {{name_prefix}}chain_blocking_idx ON {{prefix}}job (type_name, blocking, chain_index, created_at)`,
              ),
            ),
            [],
          );
        }
        if (!(await hasJobColumn("last_reschedule_reason"))) {
          await execute(
            undefined,
            applyTemplate(
              sql(
                /* sql */ `ALTER TABLE {{prefix}}job ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0 AFTER attempt, ADD COLUMN last_attempt_error_text LONGTEXT NULL AFTER last_attempt_error, ADD COLUMN last_reschedule_reason TEXT NULL AFTER last_attempt_error_text`,
              ),
            ),
            [],
          );
        }
        for (const statement of [
          /* sql */ `DROP TABLE IF EXISTS {{prefix}}schema_fence_v1`,
          /* sql */ `
UPDATE {{prefix}}job h
SET h.blocking = TRUE
WHERE h.chain_index = 0
  AND h.blocking = FALSE
  AND h.id IN (SELECT jb.blocked_by_chain_id FROM {{prefix}}job_blocker jb)`,
          /* sql */ `
UPDATE {{prefix}}job j
LEFT JOIN (
  SELECT jb.job_id, COUNT(*) AS remaining
  FROM {{prefix}}job_blocker jb
  LEFT JOIN {{prefix}}job h ON h.id = jb.blocked_by_chain_id
  WHERE NOT (h.chain_status <=> 'completed')
  GROUP BY jb.job_id
) r ON r.job_id = j.id
SET j.blockers_remaining = COALESCE(r.remaining, 0)
WHERE j.status = 'blocked'`,
          /* sql */ `
UPDATE {{prefix}}job j
SET j.status = 'pending',
  j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6))
WHERE j.status = 'blocked' AND j.blockers_remaining = 0`,
          /* sql */ `
UPDATE {{prefix}}job j
SET j.status = 'pending',
  j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)),
  j.attempt_at = NULL,
  j.attempt_by = NULL,
  j.attempt_token = NULL
WHERE j.status = 'running'
  AND NOT EXISTS (SELECT 1 FROM {{prefix}}worker w WHERE w.id = j.attempt_by)`,
        ]) {
          await execute(undefined, applyTemplate(sql(statement)), []);
        }
        if (await hasJobColumn("last_attempt_error_text")) {
          const statements = (await hasJobColumn("last_attempt_error"))
            ? [
                /* sql */ `UPDATE {{prefix}}job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WHERE last_attempt_error IS NOT NULL`,
                /* sql */ `ALTER TABLE {{prefix}}job DROP COLUMN last_attempt_error`,
              ]
            : [];
          for (const statement of [
            ...statements,
            /* sql */ `ALTER TABLE {{prefix}}job RENAME COLUMN last_attempt_error_text TO last_attempt_error`,
          ]) {
            await execute(undefined, applyTemplate(sql(statement)), []);
          }
        }
        await execute(
          undefined,
          applyTemplate(
            sql(
              /* sql */ `CREATE TABLE IF NOT EXISTS {{prefix}}schema_fence_v2 (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
            ),
          ),
          [],
        );
      },
      down: async () => {
        throw new Error("The Queuert schema cannot be reverted.");
      },
    },
  ];

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
      if (lock !== "exclusive") {
        const [rows] = await executeBatch(txCtx, [getChainsStatement(chainIds)]);
        const chains = mapChainRowsById(rows);
        return chainIds.map((id) => chains.get(id));
      }
      const sortedChainIds = JSON.stringify([...new Set(chainIds)].sort());
      if (dialect === "mariadb") {
        const [, rows] = await executeBatch(txCtx, [
          {
            sql: prepared(
              "lockChainHeads",
              `SELECT h.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id WHERE h.chain_index = 0 {{for_update:h}}`,
              { params: [t.string()], columns: { id: jobIdDataType } },
            ),
            params: [sortedChainIds],
          },
          getChainsStatement(chainIds),
        ]);
        const chains = mapChainRowsById(rows);
        return chainIds.map((id) => chains.get(id));
      }
      const rows = await execute(
        txCtx,
        prepared(
          "getChainsLocked",
          `SELECT ${selectJob("h", "h_")}, ${selectJob("t", "t_")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id ${tailJoin("h", "t")} WHERE h.chain_index = 0 {{for_update:h}}`,
          { params: [t.string()], columns: dbChainRowColumns },
        ),
        [sortedChainIds],
      );
      const chains = new Map(
        rows.map((row) => [row.h_id as string, mapDbChainRowToStateChain(row)]),
      );
      return chainIds.map((id) => chains.get(id));
    },

    getJobs: async ({
      txCtx,
      jobIds: ids,
      lock,
    }: {
      txCtx?: TTxContext;
      jobIds: TJobId[];
      lock?: "exclusive";
    }) => {
      if (ids.length === 0) return [];
      if (lock !== "exclusive") {
        const [rows] = await executeBatch(txCtx, [getJobsStatement(ids)]);
        const jobs = mapJobRowsById(rows);
        return ids.map((id) => jobs.get(id));
      }
      const rows = await execute(
        txCtx,
        prepared(
          "getJobsLocked",
          `SELECT ${selectJob("j")}, ${selectChain("h", "c_")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = j.chain_id {{for_update:j:h}}`,
          { params: [t.string()], columns: dbJobRowColumns },
        ),
        [sortedIdsParam(ids)],
      );
      const jobs = new Map(rows.map((row) => [row.id as string, mapDbJobRowToStateJob(row)]));
      return ids.map((id) => jobs.get(id));
    },

    getWorkers: async ({
      txCtx,
      workerIds: ids,
      lock,
    }: {
      txCtx?: TTxContext;
      workerIds: TWorkerId[];
      lock?: "exclusive";
    }) => {
      if (ids.length === 0) return [];
      const rows = await execute(
        txCtx,
        lock === "exclusive"
          ? prepared(
              "getWorkersLocked",
              `SELECT ${selectWorker("w")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{worker_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}worker w FORCE INDEX (PRIMARY) ON w.id = d.id {{for_update:w}}`,
              { params: [t.string()], columns: dbWorkerColumns },
            )
          : prepared(
              "getWorkers",
              `SELECT ${selectWorker("w")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{worker_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}worker w FORCE INDEX (PRIMARY) ON w.id = d.id`,
              { params: [t.string()], columns: dbWorkerColumns, readOnly: true },
            ),
        [sortedIdsParam(ids)],
      );
      const workers = new Map(
        rows.map((row) => [row.id as string, mapDbWorkerToStateWorkerInfo(row)]),
      );
      return ids.map((id) => workers.get(id));
    },

    createJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];

      const deduplicationItems = jobs.flatMap((job, index) =>
        job.deduplication
          ? [
              {
                index,
                key: job.deduplication.key,
                type_name: job.typeName,
                scope: job.deduplication.scope,
              },
            ]
          : [],
      );
      const existingByIndex = new Map<number, StateChain>();
      if (deduplicationItems.length > 0) {
        const rows = await execute(
          txCtx,
          prepared(
            "findDeduplicatedChains",
            `
SELECT d.item_index, ${selectJob("h", "h_")}, ${selectJob("t", "t_")}
FROM JSON_TABLE(?, '$[*]' COLUMNS (
  item_index INT PATH '$.index',
  deduplication_key {{name_type}} PATH '$.key',
  type_name {{name_type}} PATH '$.type_name',
  scope VARCHAR(16) PATH '$.scope'
)) d
JOIN {{prefix}}job h ON h.id = (
  SELECT e.id FROM {{prefix}}job e
  WHERE e.chain_deduplication_key = d.deduplication_key
    AND e.type_name = d.type_name
    AND e.chain_index = 0
    AND ((d.scope = 'running' AND e.chain_status = 'running') OR d.scope = 'any')
    AND {{fence_guard}}
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1
)
${tailJoin("h", "t")}`,
            { params: [t.string()], columns: { item_index: t.number(), ...dbChainRowColumns } },
          ),
          [toJsonParam(deduplicationItems)],
        );
        for (const row of rows)
          existingByIndex.set(Number(row.item_index), mapDbChainRowToStateChain(row));
      }

      const firstIndexByKey = new Map<string, number>();
      const plan = jobs.map((job, index): { duplicateOf?: number; insert: boolean } => {
        if (existingByIndex.has(index)) return { insert: false };
        if (!job.deduplication) return { insert: true };
        const key = JSON.stringify([job.deduplication.key, job.typeName]);
        const first = firstIndexByKey.get(key);
        if (first !== undefined) return { insert: false, duplicateOf: first };
        firstIndexByKey.set(key, index);
        return { insert: true };
      });
      const inserted = jobs.filter((_job, index) => plan[index].insert);

      const insertedById = new Map<string, Row>();
      if (inserted.length > 0) {
        const [, rows] = await executeBatch(txCtx, [
          {
            sql: prepared(
              "createJobs",
              `
INSERT INTO {{prefix}}job (id, type_name, chain_id, chain_index, chain_status, input, chain_deduplication_key, scheduled_at, chain_trace_context, trace_context)
SELECT d.id, d.type_name, d.id, 0, 'running', JSON_EXTRACT(d.input, '$'), d.deduplication_key, ${scheduleExpression("d")}, d.chain_trace_context, d.trace_context
FROM JSON_TABLE(?, '$[*]' COLUMNS (
  id {{job_id_type}} PATH '$.id',
  type_name {{name_type}} PATH '$.type_name',
  input LONGTEXT CHARACTER SET utf8mb4 PATH '$.input',
  deduplication_key {{name_type}} PATH '$.deduplication_key',
  scheduled_at DATETIME(6) PATH '$.scheduled_at',
  schedule_after_ms DOUBLE PATH '$.schedule_after_ms',
  chain_trace_context LONGTEXT CHARACTER SET utf8mb4 PATH '$.chain_trace_context',
  trace_context LONGTEXT CHARACTER SET utf8mb4 PATH '$.trace_context'
)) d
WHERE {{fence_guard}}`,
              { params: [t.string()] },
            ),
            params: [
              toJsonParam(
                inserted.map((job) => ({
                  id: job.id,
                  type_name: job.typeName,
                  input: stringifyOptional(job.input),
                  deduplication_key: job.deduplication?.key,
                  scheduled_at: job.schedule?.at ? formatTimestamp(job.schedule.at) : undefined,
                  schedule_after_ms: job.schedule?.afterMs,
                  chain_trace_context: job.chainTraceContext,
                  trace_context: job.traceContext,
                })),
              ),
            ],
          },
          {
            sql: prepared(
              "readCreatedJobs",
              `SELECT ${selectJob("h", "h_")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id`,
              { params: [t.string()], columns: prefixColumns(dbJobColumns, "h_") },
            ),
            params: [JSON.stringify(inserted.map((job) => job.id))],
          },
        ]);
        for (const row of rows) insertedById.set(row.h_id as string, row);
      }

      return jobs.map((_job, index) => {
        const existing = existingByIndex.get(index);
        if (existing) return { ...existing, deduplicated: true };
        const { duplicateOf } = plan[index];
        const row = insertedById.get(jobs[duplicateOf ?? index].id)!;
        return {
          ...mapDbHeadToStateChainInfo(row, "h_"),
          head: mapDbJobToStateJobInfo(row, "h_")!,
          tail: undefined,
          deduplicated: duplicateOf !== undefined,
        };
      });
    },

    continueJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];
      const continuations = toJsonParam(
        [...jobs].sort(compareBy((job) => job.continueFromId)).map((job) => ({
          new_id: job.id,
          type_name: job.typeName,
          input: stringifyOptional(job.input),
          scheduled_at: job.schedule?.at ? formatTimestamp(job.schedule.at) : undefined,
          schedule_after_ms: job.schedule?.afterMs,
          trace_context: job.traceContext,
          continue_from_id: job.continueFromId,
          attempt_token: job.attemptToken,
          worker_id: job.workerId,
        })),
      );
      const continuationColumns = `
  new_id {{job_id_type}} PATH '$.new_id',
  type_name {{name_type}} PATH '$.type_name',
  input LONGTEXT CHARACTER SET utf8mb4 PATH '$.input',
  scheduled_at DATETIME(6) PATH '$.scheduled_at',
  schedule_after_ms DOUBLE PATH '$.schedule_after_ms',
  trace_context LONGTEXT CHARACTER SET utf8mb4 PATH '$.trace_context',
  continue_from_id {{job_id_type}} PATH '$.continue_from_id',
  attempt_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PATH '$.attempt_token',
  worker_id {{worker_id_type}} PATH '$.worker_id'`;

      const [, , rows] = await executeBatch(txCtx, [
        {
          sql: prepared(
            "completeContinuedJobs",
            `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (${continuationColumns})) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.continue_from_id
SET j.status = 'completed',
  j.completed_at = UTC_TIMESTAMP(6),
  j.completed_by = d.worker_id,
  j.continued_to_id = d.new_id,
  j.output = NULL,
  j.consecutive_failures = 0,
  j.last_attempt_error = NULL,
  j.last_reschedule_reason = NULL,
  j.attempt_at = NULL,
  j.attempt_by = NULL,
  j.attempt_token = NULL
WHERE ${writableJobCondition}
  AND {{fence_guard}}`,
            { params: [t.string()] },
          ),
          params: [continuations],
        },
        {
          sql: prepared(
            "insertContinuations",
            `
INSERT INTO {{prefix}}job (id, type_name, chain_id, chain_index, input, scheduled_at, trace_context)
SELECT d.new_id, d.type_name, c.chain_id, c.chain_index + 1, JSON_EXTRACT(d.input, '$'), ${scheduleExpression("d")}, d.trace_context
FROM JSON_TABLE(?, '$[*]' COLUMNS (${continuationColumns})) d
STRAIGHT_JOIN {{prefix}}job c FORCE INDEX (PRIMARY) ON c.id = d.continue_from_id
JOIN JSON_TABLE(?, '$[*]' COLUMNS (${continuationColumns})) completed_by_batch
  ON completed_by_batch.continue_from_id = c.id AND completed_by_batch.new_id = c.continued_to_id
WHERE {{fence_guard}}`,
            { params: [t.string(), t.string()] },
          ),
          params: [continuations, continuations],
        },
        {
          sql: prepared(
            "readContinuedJobs",
            `
SELECT d.new_id AS continuation_id, ${selectJob("j")}, ${selectChain("h", "c_")}, ${selectJob("n", "n_")}
FROM JSON_TABLE(?, '$[*]' COLUMNS (${continuationColumns})) d
JOIN {{prefix}}job j ON j.id = d.continue_from_id AND j.continued_to_id = d.new_id
JOIN {{prefix}}job n ON n.id = d.new_id
JOIN {{prefix}}job h ON h.id = j.chain_id`,
            {
              params: [t.string()],
              columns: {
                continuation_id: jobIdDataType,
                ...dbJobRowColumns,
                ...prefixColumns(dbJobColumns, "n_"),
              },
            },
          ),
          params: [continuations],
        },
      ]);
      const rowByContinuationId = new Map(rows.map((row) => [row.continuation_id as string, row]));
      return jobs.map((job) => {
        const row = rowByContinuationId.get(job.id);
        if (!row) return undefined;
        return { ...mapDbJobRowToStateJob(row), continuation: mapDbJobToStateJobInfo(row, "n_")! };
      });
    },

    completeJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];
      const ids = jobs.map((job) => job.jobId);
      const [lockedRows, , completedRows] = await executeBatch(txCtx, [
        {
          sql: prepared(
            "lockCompletedJobs",
            `SELECT j.id, j.status, j.attempt_token FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = j.chain_id WHERE {{fence_guard}} {{for_update:j:h}}`,
            {
              params: [t.string()],
              columns: { id: jobIdDataType, status: t.string(), attempt_token: t["uuid?"]() },
            },
          ),
          params: [sortedIdsParam(ids)],
        },
        {
          sql: prepared(
            "completeJobs",
            `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (
  job_id {{job_id_type}} PATH '$.job_id',
  output LONGTEXT CHARACTER SET utf8mb4 PATH '$.output',
  worker_id {{worker_id_type}} PATH '$.worker_id',
  attempt_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PATH '$.attempt_token'
)) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.job_id
LEFT JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = j.chain_id AND h.id <> j.id
SET j.chain_status = CASE WHEN j.id = j.chain_id THEN 'completed' ELSE j.chain_status END,
  j.chain_completed_at = CASE WHEN j.id = j.chain_id THEN COALESCE(j.chain_completed_at, UTC_TIMESTAMP(6)) ELSE j.chain_completed_at END,
  j.status = 'completed',
  j.consecutive_failures = 0,
  j.last_attempt_error = NULL,
  j.last_reschedule_reason = NULL,
  j.attempt_at = NULL,
  j.attempt_by = NULL,
  j.attempt_token = NULL,
  j.completed_at = UTC_TIMESTAMP(6),
  j.completed_by = d.worker_id,
  j.output = JSON_EXTRACT(d.output, '$'),
  h.chain_status = 'completed',
  h.chain_completed_at = COALESCE(h.chain_completed_at, UTC_TIMESTAMP(6))
WHERE ${writableJobCondition}
  AND {{fence_guard}}`,
            { params: [t.string()] },
          ),
          params: [
            toJsonParam(
              [...jobs].sort(compareBy((job) => job.jobId)).map((job) => ({
                job_id: job.jobId,
                output: stringifyOptional(job.output),
                worker_id: job.workerId,
                attempt_token: job.attemptToken,
              })),
            ),
          ],
        },
        getJobsStatement(ids),
      ]);
      const locked = mapLockedJobRowsById(lockedRows);
      const completed = mapJobRowsById(completedRows);
      return jobs.map((job) =>
        isWritable(locked.get(job.jobId), job.attemptToken) ? completed.get(job.jobId) : undefined,
      );
    },

    rescheduleJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];
      const ids = jobs.map((job) => job.jobId);
      const reschedules = toJsonParam(
        [...jobs].sort(compareBy((job) => job.jobId)).map((job) => ({
          job_id: job.jobId,
          attempt_token: job.attemptToken,
          scheduled_at: job.schedule?.at ? formatTimestamp(job.schedule.at) : undefined,
          schedule_after_ms: job.schedule?.afterMs,
          error: job.error,
          reason: job.reason,
        })),
      );
      const rescheduleColumns = `
  job_id {{job_id_type}} PATH '$.job_id',
  attempt_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PATH '$.attempt_token',
  scheduled_at DATETIME(6) PATH '$.scheduled_at',
  schedule_after_ms DOUBLE PATH '$.schedule_after_ms',
  error LONGTEXT CHARACTER SET utf8mb4 PATH '$.error',
  reason LONGTEXT CHARACTER SET utf8mb4 PATH '$.reason'`;
      return withOwnTransaction(txCtx, async (txCtx) => {
        const writableRows = await execute(
          txCtx,
          prepared(
            "lockRescheduledJobs",
            `SELECT d.job_id, d.attempt_token FROM JSON_TABLE(?, '$[*]' COLUMNS (${rescheduleColumns})) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.job_id WHERE ${writableJobCondition} AND {{fence_guard}} {{for_update:j}}`,
            {
              params: [t.string()],
              columns: { job_id: jobIdDataType, attempt_token: t["uuid?"]() },
            },
          ),
          [reschedules],
        );
        if (writableRows.length === 0) return jobs.map(() => undefined);
        const [, rescheduledRows] = await executeBatch(txCtx, [
          {
            sql: prepared(
              "rescheduleJobs",
              `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (${rescheduleColumns})) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.job_id
STRAIGHT_JOIN {{prefix}}job s FORCE INDEX (PRIMARY) ON s.id = j.id
SET j.last_attempt_at = CASE WHEN s.status = 'running' THEN UTC_TIMESTAMP(6) ELSE j.last_attempt_at END,
  j.consecutive_failures = CASE WHEN s.status = 'running' AND d.error IS NOT NULL THEN j.consecutive_failures + 1 ELSE 0 END,
  j.last_attempt_error = CASE WHEN s.status = 'running' THEN d.error ELSE j.last_attempt_error END,
  j.last_reschedule_reason = CASE WHEN s.status = 'running' AND d.error IS NOT NULL THEN NULL ELSE d.reason END,
  j.status = CASE WHEN s.status = 'running' THEN 'pending' ELSE j.status END,
  j.scheduled_at = ${scheduleExpression("d")},
  j.attempt_at = NULL,
  j.attempt_by = NULL,
  j.attempt_token = NULL
WHERE ${writableJobCondition}
  AND {{fence_guard}}`,
              { params: [t.string()] },
            ),
            params: [reschedules],
          },
          getJobsStatement(ids),
        ]);
        const writable = new Set(
          writableRows.map(
            (row) => `${row.job_id as string}:${(row.attempt_token as string | null) ?? ""}`,
          ),
        );
        const rescheduled = mapJobRowsById(rescheduledRows);
        return jobs.map((job) =>
          writable.has(`${job.jobId}:${job.attemptToken ?? ""}`)
            ? rescheduled.get(job.jobId)
            : undefined,
        );
      });
    },

    deleteChains: async ({ txCtx, chainIds }) => {
      if (chainIds.length === 0) return [];
      const chainIdsParam = sortedIdsParam(chainIds);
      const heights = await execute(
        txCtx,
        prepared(
          "readDeletedChainHeights",
          `
WITH RECURSIVE climb (origin, id, height) AS (
  SELECT d.id, d.id, 0
  FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
  UNION DISTINCT
  SELECT jb.blocked_by_chain_id, jb.blocked_by_chain_id, 0
  FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
  STRAIGHT_JOIN {{prefix}}job m FORCE INDEX ({{name_prefix}}chain_index_idx) ON m.chain_id = d.id
  STRAIGHT_JOIN {{prefix}}job_blocker jb FORCE INDEX (PRIMARY) ON jb.job_id = m.id
  UNION DISTINCT
  SELECT c.origin, jb.blocked_by_chain_id, c.height + 1
  FROM climb c
  STRAIGHT_JOIN {{prefix}}job j FORCE INDEX ({{name_prefix}}chain_index_idx) ON j.chain_id = c.id
  STRAIGHT_JOIN {{prefix}}job_blocker jb FORCE INDEX (PRIMARY) ON jb.job_id = j.id
  WHERE c.height < 64
)
SELECT origin AS id, MAX(height) AS height FROM climb GROUP BY origin`,
          {
            params: [t.string(), t.string()],
            columns: { id: jobIdDataType, height: t.number() },
            readOnly: true,
          },
        ),
        [chainIdsParam, chainIdsParam],
      );
      const deletedChainIds = new Set<string>(chainIds);
      const referencedHeadIds = heights
        .map((row) => row.id as string)
        .filter((id) => !deletedChainIds.has(id));
      const [, members, externalRefs, chainRows] = await executeBatch(txCtx, [
        {
          sql: prepared(
            "lockDeletedChainHeads",
            `SELECT h.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id WHERE h.chain_index = 0 {{for_update:h}}`,
            { params: [t.string()], columns: { id: jobIdDataType } },
          ),
          params: [
            JSON.stringify(
              heights
                .toSorted(
                  (a, b) =>
                    Number(a.height) - Number(b.height) ||
                    (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0),
                )
                .map((row) => row.id),
            ),
          ],
        },
        {
          sql: prepared(
            "lockDeletedChains",
            `SELECT j.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX ({{name_prefix}}chain_index_idx) ON j.chain_id = d.id {{for_update:j}}`,
            { params: [t.string()], columns: { id: jobIdDataType } },
          ),
          params: [chainIdsParam],
        },
        {
          sql: prepared(
            "findExternalBlockerRefs",
            `
SELECT jb.job_id AS b_job_id, jb.blocked_by_chain_id AS b_blocked_by_chain_id, jb.\`index\` AS b_index, jb.trace_context AS b_trace_context, ${selectJob("j")}
FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
STRAIGHT_JOIN {{prefix}}job bh FORCE INDEX (PRIMARY) ON bh.id = d.id AND bh.chain_index = 0 AND bh.blocking = TRUE
STRAIGHT_JOIN {{prefix}}job_blocker jb FORCE INDEX ({{name_prefix}}job_blocker_chain_idx) ON jb.blocked_by_chain_id = d.id
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = jb.job_id
WHERE j.chain_id NOT IN (${jobIds("member_list")})
ORDER BY jb.job_id, jb.\`index\``,
            { params: [t.string(), t.string()], columns: { ...dbBlockerColumns, ...dbJobColumns } },
          ),
          params: [chainIdsParam, chainIdsParam],
        },
        getChainsStatement(chainIds),
      ]);
      if (externalRefs.length > 0) {
        const refsByChainId = Map.groupBy(
          externalRefs,
          (row) => row.b_blocked_by_chain_id as string,
        );
        return chainIds.map((chainId) =>
          refsByChainId
            .get(chainId)
            ?.map((row) => mapDbBlockerRowToStateBlockedJob(row, mapDbJobToStateJobInfo(row)!)),
        );
      }

      const chains = mapChainRowsById(chainRows);
      if (members.length > 0) {
        const [, stillReferenced = []] = await executeBatch(txCtx, [
          {
            sql: prepared(
              "deleteChainJobs",
              `
DELETE jb, j
FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id
LEFT JOIN {{prefix}}job_blocker jb FORCE INDEX (PRIMARY) ON jb.job_id = j.id
WHERE {{fence_guard}}`,
              { params: [t.string()] },
            ),
            params: [sortedIdsParam(members.map((row) => row.id as string))],
          },
          ...(referencedHeadIds.length > 0
            ? [
                {
                  sql: prepared(
                    "findStillReferencedBlockerHeads",
                    `SELECT DISTINCT jb.blocked_by_chain_id AS id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job_blocker jb FORCE INDEX ({{name_prefix}}job_blocker_chain_idx) ON jb.blocked_by_chain_id = d.id`,
                    { params: [t.string()], columns: { id: jobIdDataType }, readOnly: true },
                  ),
                  params: [sortedIdsParam(referencedHeadIds)],
                },
              ]
            : []),
        ]);
        const stillReferencedIds = new Set(stillReferenced.map((row) => row.id as string));
        const unreferencedHeadIds = referencedHeadIds.filter((id) => !stillReferencedIds.has(id));
        if (unreferencedHeadIds.length > 0) {
          await execute(
            txCtx,
            prepared(
              "clearUnreferencedBlockerHeads",
              `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id
SET h.blocking = FALSE
WHERE h.blocking = TRUE AND {{fence_guard}}`,
              { params: [t.string()] },
            ),
            [sortedIdsParam(unreferencedHeadIds)],
          );
        }
      }
      return chainIds.map((chainId) => {
        const chain = chains.get(chainId);
        return chain && { ...chain, blocking: false };
      });
    },

    startJobAttempts: async ({ txCtx, typeNames, workerId, workerToken, limit }) => {
      if (typeNames.length === 0) return [];
      return withOwnTransaction(txCtx, async (txCtx) => {
        const [[liveWorker], pickedRows] = await executeBatch(txCtx, [
          {
            sql: prepared(
              "lockLiveWorker",
              `SELECT id FROM {{prefix}}worker WHERE id = ? AND token = ? AND lease_until > UTC_TIMESTAMP(6) AND {{fence_guard}} LOCK IN SHARE MODE`,
              { params: [workerIdDataType, t.uuid()], columns: { id: workerIdDataType } },
            ),
            params: [workerId, workerToken],
          },
          {
            sql: prepared(
              `pickPendingJobs:${typeNames.length}`,
              `${typeNames
                .map(
                  () =>
                    `(SELECT id, type_name, CAST(status_ts AS CHAR) AS picked_ts FROM {{prefix}}job FORCE INDEX ({{name_prefix}}job_status_idx) WHERE type_name = ? AND status = 'pending' AND status_ts <= UTC_TIMESTAMP(6) AND EXISTS (SELECT 1 FROM {{prefix}}worker w WHERE w.id = ? AND w.token = ? AND w.lease_until > UTC_TIMESTAMP(6)) ORDER BY status_ts LIMIT ? FOR UPDATE SKIP LOCKED)`,
                )
                .join(" UNION ALL ")} ORDER BY picked_ts LIMIT ?`,
              {
                params: [
                  ...typeNames.flatMap(() => [t.string(), workerIdDataType, t.uuid(), t.number()]),
                  t.number(),
                ],
                columns: { id: jobIdDataType, type_name: t.string(), picked_ts: t.string() },
              },
            ),
            params: [
              ...typeNames.flatMap((typeName) => [
                typeName,
                workerId,
                workerToken,
                Math.ceil(limit / typeNames.length),
              ]),
              limit,
            ],
          },
        ]);
        if (!liveWorker) return [];
        const pickedIds = pickedRows.map((row) => row.id as string);
        const saturatedTypeNames = typeNames.filter(
          (typeName) =>
            pickedRows.filter((row) => row.type_name === typeName).length ===
            Math.ceil(limit / typeNames.length),
        );
        if (pickedIds.length < limit && saturatedTypeNames.length > 0) {
          const fillRows = await execute(
            txCtx,
            prepared(
              `pickMorePendingJobs:${saturatedTypeNames.length}`,
              `${saturatedTypeNames
                .map(
                  () =>
                    `(SELECT id, CAST(status_ts AS CHAR) AS picked_ts FROM {{prefix}}job FORCE INDEX ({{name_prefix}}job_status_idx) WHERE type_name = ? AND status = 'pending' AND status_ts <= UTC_TIMESTAMP(6) AND id NOT IN (${jobIds()}) ORDER BY status_ts LIMIT ? FOR UPDATE SKIP LOCKED)`,
                )
                .join(" UNION ALL ")} ORDER BY picked_ts LIMIT ?`,
              {
                params: [
                  ...saturatedTypeNames.flatMap(() => [t.string(), t.string(), t.number()]),
                  t.number(),
                ],
                columns: { id: jobIdDataType, picked_ts: t.string() },
              },
            ),
            [
              ...saturatedTypeNames.flatMap((typeName) => [
                typeName,
                JSON.stringify(pickedIds),
                limit - pickedIds.length,
              ]),
              limit - pickedIds.length,
            ],
          );
          pickedIds.push(...fillRows.map((row) => row.id as string));
        }
        if (pickedIds.length === 0) return [];

        const [, rows] = await executeBatch(txCtx, [
          {
            sql: prepared(
              "claimJobs",
              `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (
  id {{job_id_type}} PATH '$.id',
  attempt_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PATH '$.attempt_token'
)) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id
SET j.status = 'running',
  j.attempt = j.attempt + 1,
  j.attempt_at = UTC_TIMESTAMP(6),
  j.attempt_by = ?,
  j.attempt_token = d.attempt_token
WHERE {{fence_guard}}`,
              { params: [t.string(), workerIdDataType] },
            ),
            params: [
              JSON.stringify(pickedIds.map((id) => ({ id, attempt_token: randomUUID() }))),
              workerId,
            ],
          },
          {
            sql: prepared(
              "readClaimedJobs",
              `
SELECT ${selectJob("j")}, ${selectChain("h", "c_")},
  EXISTS (SELECT 1 FROM {{prefix}}job_blocker jb WHERE jb.job_id = j.id) AS has_blockers
FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id
STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = j.chain_id`,
              { params: [t.string()], columns: { ...dbJobRowColumns, has_blockers: t.number() } },
            ),
            params: [JSON.stringify(pickedIds)],
          },
        ]);
        return rows.map((row) => ({
          ...mapDbJobRowToStateJob(row),
          hasBlockers: toBoolean(row.has_blockers),
        }));
      });
    },

    getStartAttemptDelayMs: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return null;
      const [next] = await execute(
        txCtx,
        prepared(
          `getStartAttemptDelayMs:${typeNames.length}`,
          `${[
            ...typeNames.map(
              () =>
                `(SELECT 0 AS delay_ms FROM {{prefix}}job FORCE INDEX ({{name_prefix}}job_status_idx) WHERE type_name = ? AND status = 'pending' AND status_ts <= UTC_TIMESTAMP(6) ORDER BY status_ts LIMIT 1 FOR UPDATE SKIP LOCKED)`,
            ),
            ...typeNames.map(
              () =>
                `(SELECT CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), status_ts) / 1000) AS delay_ms FROM {{prefix}}job FORCE INDEX ({{name_prefix}}job_status_idx) WHERE type_name = ? AND status = 'pending' AND status_ts > UTC_TIMESTAMP(6) ORDER BY status_ts LIMIT 1)`,
            ),
          ].join(" UNION ALL ")} ORDER BY delay_ms LIMIT 1`,
          {
            params: [...typeNames, ...typeNames].map(() => t.string()),
            columns: { delay_ms: t.number() },
          },
        ),
        [...typeNames, ...typeNames],
      );
      return next === undefined ? null : Math.max(0, Number(next.delay_ms));
    },

    addJobsBlockers: async ({ txCtx, jobBlockers }) => {
      if (jobBlockers.length === 0) return [];

      const blockerChainIdsParam = sortedIdsParam(
        jobBlockers.flatMap((entry) => entry.blockedByChainIds),
      );
      const blockerRows = jobBlockers
        .flatMap(({ jobId, blockedByChainIds, blockerTraceContexts }) =>
          blockedByChainIds.map((blockedByChainId, index) => ({
            job_id: jobId,
            blocked_by_chain_id: blockedByChainId,
            index,
            trace_context: blockerTraceContexts?.[index] ?? undefined,
          })),
        )
        .sort(compareBy((row) => row.job_id));
      const [headRows] = await executeBatch(txCtx, [
        {
          sql: prepared(
            "lockBlockerHeads",
            `SELECT ${selectJob("h", "h_")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id WHERE h.chain_index = 0 AND {{fence_guard}} {{for_update:h}}`,
            {
              params: [t.string()],
              columns: prefixColumns(dbJobColumns, "h_"),
            },
          ),
          params: [blockerChainIdsParam],
        },
        ...(blockerRows.length > 0
          ? [
              {
                sql: prepared(
                  "flagBlockerHeads",
                  `UPDATE JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND {{fence_guard}}`,
                  { params: [t.string()] },
                ),
                params: [blockerChainIdsParam],
              },
              {
                sql: prepared(
                  "insertJobBlockers",
                  `
INSERT INTO {{prefix}}job_blocker (job_id, blocked_by_chain_id, \`index\`, trace_context)
SELECT d.job_id, d.blocked_by_chain_id, d.blocker_index, d.trace_context
FROM JSON_TABLE(?, '$[*]' COLUMNS (
  job_id {{job_id_type}} PATH '$.job_id',
  blocked_by_chain_id {{job_id_type}} PATH '$.blocked_by_chain_id',
  blocker_index INT PATH '$.index',
  trace_context LONGTEXT CHARACTER SET utf8mb4 PATH '$.trace_context'
)) d
STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.blocked_by_chain_id
WHERE h.chain_index = 0 AND {{fence_guard}}`,
                  { params: [t.string()] },
                ),
                params: [toJsonParam(blockerRows)],
              },
            ]
          : []),
      ]);
      const blockerChains = new Map(
        headRows.map((row) => [
          row.h_id as string,
          { ...mapDbHeadToStateChainInfo(row, "h_"), blocking: true },
        ]),
      );

      const remainingByJobId = new Map<string, number>();
      for (const row of blockerRows) {
        if (blockerChains.get(row.blocked_by_chain_id)?.status === "running") {
          remainingByJobId.set(row.job_id, (remainingByJobId.get(row.job_id) ?? 0) + 1);
        }
      }
      const results = await executeBatch(txCtx, [
        ...(remainingByJobId.size > 0
          ? [
              {
                sql: prepared(
                  "blockDependents",
                  `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$[0]', remaining INT PATH '$[1]')) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id
SET j.status = 'blocked',
  j.blockers_remaining = j.blockers_remaining + d.remaining
WHERE j.status IN ('pending', 'blocked') AND {{fence_guard}}`,
                  { params: [t.string()] },
                ),
                params: [
                  JSON.stringify(
                    [...remainingByJobId].sort(([left], [right]) =>
                      left < right ? -1 : left > right ? 1 : 0,
                    ),
                  ),
                ],
              },
            ]
          : []),
        getJobsStatement(jobBlockers.map((entry) => entry.jobId)),
      ]);
      const dependents = mapJobRowsById(results.at(-1)!);
      return jobBlockers.map((entry) => ({
        ...dependents.get(entry.jobId)!,
        blockers: entry.blockedByChainIds.map((chainId) => blockerChains.get(chainId)),
      }));
    },

    getJobBlockers: async ({ txCtx, jobId }) => {
      const rows = await execute(
        txCtx,
        prepared(
          "getJobBlockers",
          `
SELECT ${selectJob("h", "h_")}, ${selectJob("t", "t_")}
FROM {{prefix}}job_blocker b
JOIN {{prefix}}job h ON h.id = b.blocked_by_chain_id
${tailJoin("h", "t")}
WHERE b.job_id = ?
ORDER BY b.\`index\``,
          { params: [jobIdDataType], columns: dbChainRowColumns, readOnly: true },
        ),
        [jobId],
      );
      return rows.map(mapDbChainRowToStateChain);
    },

    unblockJobs: async ({ txCtx, blockedByChainId }) => {
      const blockerRows = await execute(
        txCtx,
        prepared(
          "lockDependentBlockers",
          `SELECT jb.job_id AS b_job_id, jb.blocked_by_chain_id AS b_blocked_by_chain_id, jb.\`index\` AS b_index, jb.trace_context AS b_trace_context FROM {{prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = ? AND {{fence_guard}} ORDER BY jb.job_id, jb.\`index\` LOCK IN SHARE MODE`,
          { params: [jobIdDataType], columns: dbBlockerColumns },
        ),
        [blockedByChainId],
      );
      if (blockerRows.length === 0) return [];
      const removedByJobId = new Map<string, number>();
      for (const row of blockerRows) {
        const jobId = row.b_job_id as string;
        removedByJobId.set(jobId, (removedByJobId.get(jobId) ?? 0) + 1);
      }
      const [, dependentRows] = await executeBatch(txCtx, [
        {
          sql: prepared(
            "countDownDependents",
            `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$[0]', removed INT PATH '$[1]')) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id
SET j.status = CASE WHEN j.blockers_remaining <= d.removed THEN 'pending' ELSE j.status END,
  j.scheduled_at = CASE WHEN j.blockers_remaining <= d.removed THEN GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)) ELSE j.scheduled_at END,
  j.blockers_remaining = j.blockers_remaining - d.removed
WHERE j.status = 'blocked' AND {{fence_guard}}`,
            { params: [t.string()] },
          ),
          params: [
            JSON.stringify(
              [...removedByJobId].sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
              ),
            ),
          ],
        },
        getJobsStatement([...removedByJobId.keys()]),
      ]);
      const dependents = mapJobRowsById(dependentRows);
      return blockerRows.map((row): StateDependentJob =>
        mapDbBlockerRowToStateBlockedJob(row, dependents.get(row.b_job_id as string)!),
      );
    },

    startWorker: async ({ txCtx, workerId, typeNames, concurrency, leaseMs }) => {
      const [, [row]] = await executeBatch(txCtx, [
        {
          sql: prepared(
            "startWorker",
            `
INSERT INTO {{prefix}}worker (id, type_names, concurrency, started_at, lease_until, token)
SELECT ?, JSON_EXTRACT(?, '$'), ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL ROUND(? * 1000) MICROSECOND, ?
FROM DUAL
WHERE {{fence_guard}}`,
            { params: [workerIdDataType, t.string(), t.number(), t.number(), t.uuid()] },
          ),
          params: [workerId, JSON.stringify(typeNames), concurrency, leaseMs, randomUUID()],
        },
        getWorkerStatement(workerId),
      ]);
      return mapDbWorkerToStateWorkerInfo(row);
    },

    extendWorkerLease: async ({ txCtx, workerId, workerToken, leaseMs }) =>
      withOwnTransaction(txCtx, async (txCtx) => {
        const [live] = await execute(
          txCtx,
          prepared(
            "lockLiveWorkerForUpdate",
            `SELECT id FROM {{prefix}}worker WHERE id = ? AND token = ? AND lease_until > UTC_TIMESTAMP(6) AND {{fence_guard}} FOR UPDATE`,
            { params: [workerIdDataType, t.uuid()], columns: { id: workerIdDataType } },
          ),
          [workerId, workerToken],
        );
        if (!live) return undefined;
        const [, [row]] = await executeBatch(txCtx, [
          {
            sql: prepared(
              "extendWorkerLease",
              `UPDATE {{prefix}}worker SET lease_until = UTC_TIMESTAMP(6) + INTERVAL ROUND(? * 1000) MICROSECOND WHERE id = ? AND {{fence_guard}}`,
              { params: [t.number(), workerIdDataType] },
            ),
            params: [leaseMs, workerId],
          },
          getWorkerStatement(workerId),
        ]);
        return row ? mapDbWorkerToStateWorkerInfo(row) : undefined;
      }),

    stopWorker: async ({ txCtx, workerId, workerToken }) =>
      withOwnTransaction(txCtx, async (txCtx) => {
        const [[row]] = await executeBatch(txCtx, [
          {
            sql: prepared(
              "lockStoppedWorker",
              `SELECT ${selectWorker("w")} FROM {{prefix}}worker w WHERE w.id = ? AND w.token = ? FOR UPDATE`,
              { params: [workerIdDataType, t.uuid()], columns: dbWorkerColumns },
            ),
            params: [workerId, workerToken],
          },
          {
            sql: prepared(
              "stopWorker",
              `DELETE FROM {{prefix}}worker WHERE id = ? AND token = ? AND {{fence_guard}}`,
              { params: [workerIdDataType, t.uuid()] },
            ),
            params: [workerId, workerToken],
          },
        ]);
        return row ? mapDbWorkerToStateWorkerInfo(row) : undefined;
      }),

    getChainTypeNames: async ({ txCtx }) => {
      const rows = await execute(
        txCtx,
        prepared(
          "getChainTypeNames",
          `SELECT DISTINCT type_name FROM {{prefix}}job WHERE chain_index = 0 ORDER BY type_name`,
          { columns: { type_name: t.string() }, readOnly: true },
        ),
      );
      return rows.map((row) => row.type_name as string);
    },

    getJobTypeNames: async ({ txCtx }) => {
      const rows = await execute(
        txCtx,
        prepared(
          "getJobTypeNames",
          `SELECT DISTINCT type_name FROM {{prefix}}job ORDER BY type_name`,
          { columns: { type_name: t.string() }, readOnly: true },
        ),
      );
      return rows.map((row) => row.type_name as string);
    },

    countChainsByTypeName: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return [];
      const cappedCount = (status: StateChainStatus) =>
        `(SELECT COUNT(*) FROM (SELECT 1 FROM {{prefix}}job FORCE INDEX ({{name_prefix}}chain_running_idx) WHERE type_name = ? AND chain_status = '${status}' LIMIT ${countCap + 1}) capped)`;
      const rows = await execute(
        txCtx,
        dynamic(
          typeNames
            .map(
              (_typeName, index) =>
                `SELECT ${index} AS ord, ${cappedCount("running")} AS running_count, ${cappedCount("completed")} AS completed_count`,
            )
            .join(" UNION ALL "),
          {
            params: typeNames.flatMap(() => [t.string(), t.string()]),
            columns: { ord: t.number(), running_count: t.number(), completed_count: t.number() },
          },
        ),
        typeNames.flatMap((typeName) => [typeName, typeName]),
      );
      const byOrd = new Map(rows.map((row) => [Number(row.ord), row]));
      return typeNames.map((_typeName, index) => {
        const row = byOrd.get(index)!;
        return {
          running: capCount(row.running_count, countCap),
          completed: capCount(row.completed_count, countCap),
        };
      });
    },

    countJobsByTypeName: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return [];
      const cappedCount = (status: StateJobStatus) =>
        `(SELECT COUNT(*) FROM (SELECT 1 FROM {{prefix}}job FORCE INDEX ({{name_prefix}}job_status_idx) WHERE type_name = ? AND status = '${status}' LIMIT ${countCap + 1}) capped)`;
      const rows = await execute(
        txCtx,
        dynamic(
          typeNames
            .map(
              (_typeName, index) =>
                `SELECT ${index} AS ord, ${cappedCount("blocked")} AS blocked_count, ${cappedCount("pending")} AS pending_count, ${cappedCount("running")} AS running_count, ${cappedCount("completed")} AS completed_count`,
            )
            .join(" UNION ALL "),
          {
            params: typeNames.flatMap(() => [t.string(), t.string(), t.string(), t.string()]),
            columns: {
              ord: t.number(),
              blocked_count: t.number(),
              pending_count: t.number(),
              running_count: t.number(),
              completed_count: t.number(),
            },
          },
        ),
        typeNames.flatMap((typeName) => [typeName, typeName, typeName, typeName]),
      );
      const byOrd = new Map(rows.map((row) => [Number(row.ord), row]));
      return typeNames.map((_typeName, index) => {
        const row = byOrd.get(index)!;
        return {
          blocked: capCount(row.blocked_count, countCap),
          pending: capCount(row.pending_count, countCap),
          running: capCount(row.running_count, countCap),
          completed: capCount(row.completed_count, countCap),
        };
      });
    },

    countWorkers: async ({ txCtx }) => {
      const [row] = await execute(
        txCtx,
        prepared(
          "countWorkers",
          `SELECT COALESCE(SUM(lease_until > UTC_TIMESTAMP(6)), 0) AS live, COALESCE(SUM(lease_until <= UTC_TIMESTAMP(6)), 0) AS expired FROM {{prefix}}worker`,
          { columns: { live: t.number(), expired: t.number() }, readOnly: true },
        ),
      );
      return { live: Number(row.live), expired: Number(row.expired) };
    },

    countWorkersByTypeName: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return [];
      const rows = await execute(
        txCtx,
        prepared(
          "countWorkersByTypeName",
          `
SELECT t.ord, COALESCE(SUM(w.lease_until > UTC_TIMESTAMP(6)), 0) AS live, COALESCE(SUM(w.lease_until <= UTC_TIMESTAMP(6)), 0) AS expired
FROM JSON_TABLE(?, '$[*]' COLUMNS (ord FOR ORDINALITY, type_name {{name_type}} PATH '$')) t
LEFT JOIN {{prefix}}worker w ON JSON_CONTAINS(w.type_names, JSON_QUOTE(t.type_name))
GROUP BY t.ord
ORDER BY t.ord`,
          {
            params: [t.string()],
            columns: { ord: t.number(), live: t.number(), expired: t.number() },
            readOnly: true,
          },
        ),
        [JSON.stringify(typeNames)],
      );
      return rows.map((row) => ({ live: Number(row.live), expired: Number(row.expired) }));
    },

    countRunningJobsByWorkerId: async ({ txCtx, workerIds: ids }) => {
      if (ids.length === 0) return [];
      const rows = await execute(
        txCtx,
        prepared(
          "countRunningJobsByWorkerId",
          `
SELECT w.ord, COUNT(j.id) AS running_count
FROM JSON_TABLE(?, '$[*]' COLUMNS (ord FOR ORDINALITY, id {{worker_id_type}} PATH '$')) w
LEFT JOIN {{prefix}}job j ON j.attempt_by = w.id AND j.status = 'running'
GROUP BY w.ord
ORDER BY w.ord`,
          {
            params: [t.string()],
            columns: { ord: t.number(), running_count: t.number() },
            readOnly: true,
          },
        ),
        [JSON.stringify(ids)],
      );
      return rows.map((row) => Number(row.running_count));
    },

    listChains: async ({
      txCtx,
      typeName,
      blocking,
      from,
      to,
      status,
      orderBy,
      orderDirection,
      page,
    }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, orderBy) : null;
      const orderColumn = orderBy === "completedAt" ? "chain_completed_at" : "created_at";
      const comparison = orderDirection === "desc" ? "<" : ">";
      const direction = orderDirection === "desc" ? "DESC" : "ASC";
      const conditions = ["h.chain_index = 0", "h.type_name = ?"];
      const params: unknown[] = [typeName];
      const paramTypes: DataType[] = [t.string()];
      if (status !== undefined) conditions.push(`h.chain_status = '${status}'`);
      if (blocking !== undefined) conditions.push(`h.blocking = ${blocking ? "TRUE" : "FALSE"}`);
      if (from) {
        conditions.push(`h.${orderColumn} >= ?`);
        params.push(formatTimestamp(from));
        paramTypes.push(t.string());
      }
      if (to) {
        conditions.push(`h.${orderColumn} <= ?`);
        params.push(formatTimestamp(to));
        paramTypes.push(t.string());
      }
      if (cursor) {
        conditions.push(
          `(h.${orderColumn} ${comparison} ? OR (h.${orderColumn} = ? AND h.id ${comparison} ?))`,
        );
        params.push(cursor.value, cursor.value, cursor.id);
        paramTypes.push(t.string(), t.string(), jobIdDataType);
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());
      const pageIndex =
        blocking === true
          ? "chain_blocking_idx"
          : orderColumn === "created_at"
            ? status === undefined
              ? "chain_idx"
              : "chain_running_idx"
            : status === "completed"
              ? "chain_completed_idx"
              : undefined;

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT ${selectJob("h", "h_")}, ${selectJob("t", "t_")} FROM (SELECT h.id FROM {{prefix}}job h${pageIndex ? ` FORCE INDEX ({{name_prefix}}${pageIndex})` : ""} WHERE ${conditions.join(" AND ")} ORDER BY h.${orderColumn} ${direction}, h.id ${direction} LIMIT ?) page STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = page.id ${tailJoin("h", "t")} ORDER BY h.${orderColumn} ${direction}, h.id ${direction}`,
          { params: paramTypes, columns: dbChainRowColumns },
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
                value: lastRow[`h_${orderColumn}`] as string,
                id: lastRow.h_id as string,
              })
            : null,
      };
    },

    listJobs: async ({ txCtx, typeName, from, to, status, orderBy, orderDirection, page }) => {
      const orderColumn = {
        createdAt: "created_at",
        scheduledAt: "scheduled_at",
        completedAt: "completed_at",
        attemptAt: "attempt_at",
      }[orderBy];
      const statusTimestampColumn =
        status === undefined
          ? undefined
          : {
              blocked: "scheduled_at",
              pending: "scheduled_at",
              running: "attempt_at",
              completed: "completed_at",
            }[status];
      const usesStatusIndex = statusTimestampColumn === orderColumn;
      const sortColumn = usesStatusIndex ? "status_ts" : orderColumn;
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, orderBy) : null;
      const comparison = orderDirection === "desc" ? "<" : ">";
      const direction = orderDirection === "desc" ? "DESC" : "ASC";
      const conditions = ["j.type_name = ?"];
      const params: unknown[] = [typeName];
      const paramTypes: DataType[] = [t.string()];
      if (status !== undefined) conditions.push(`j.status = '${status}'`);
      if (from) {
        conditions.push(`j.${sortColumn} >= ?`);
        params.push(formatTimestamp(from));
        paramTypes.push(t.string());
      }
      if (to) {
        conditions.push(`j.${sortColumn} <= ?`);
        params.push(formatTimestamp(to));
        paramTypes.push(t.string());
      }
      if (cursor) {
        conditions.push(
          `(j.${sortColumn} ${comparison} ? OR (j.${sortColumn} = ? AND j.id ${comparison} ?))`,
        );
        params.push(cursor.value, cursor.value, cursor.id);
        paramTypes.push(t.string(), t.string(), jobIdDataType);
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT ${selectJob("j")}, ${selectChain("h", "c_")} FROM {{prefix}}job j${usesStatusIndex ? " FORCE INDEX ({{name_prefix}}job_status_idx)" : ""} JOIN {{prefix}}job h ON h.id = j.chain_id WHERE ${conditions.join(" AND ")} ORDER BY j.${sortColumn} ${direction}, j.id ${direction} LIMIT ?`,
          { params: paramTypes, columns: dbJobRowColumns },
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
                value: lastRow[orderColumn] as string,
                id: lastRow.id as string,
              })
            : null,
      };
    },

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeIdCursor(page.cursor) : null;
      const direction = orderDirection === "asc" ? "ASC" : "DESC";
      const comparison = orderDirection === "asc" ? ">" : "<";
      const conditions = ["j.chain_id = ?"];
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [jobIdDataType];
      if (cursor) {
        conditions.push(
          `j.chain_index ${comparison} (SELECT c.chain_index FROM {{prefix}}job c WHERE c.id = ? AND c.chain_id = ?)`,
        );
        params.push(cursor.id, chainId);
        paramTypes.push(jobIdDataType, jobIdDataType);
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const rows = await execute(
        txCtx,
        dynamic(
          `${stateJobSelect} WHERE ${conditions.join(" AND ")} ORDER BY j.chain_index ${direction}, j.id ${direction} LIMIT ?`,
          { params: paramTypes, columns: dbJobRowColumns },
        ),
        params,
      );
      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapDbJobRowToStateJob),
        nextCursor:
          hasMore && lastRow ? encodeCursor({ type: "id", id: lastRow.id as string }) : null,
      };
    },

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, "createdAt") : null;
      const comparison = orderDirection === "desc" ? "<" : ">";
      const direction = orderDirection === "desc" ? "DESC" : "ASC";
      const conditions = ["jb.blocked_by_chain_id = ?"];
      const params: unknown[] = [chainId];
      const paramTypes: DataType[] = [jobIdDataType];
      if (cursor) {
        conditions.push(
          `(j.created_at ${comparison} ? OR (j.created_at = ? AND j.id ${comparison} ?))`,
        );
        params.push(cursor.value, cursor.value, cursor.id);
        paramTypes.push(t.string(), t.string(), jobIdDataType);
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT ${selectJob("j")}, ${selectChain("h", "c_")} FROM (SELECT DISTINCT j.id, j.created_at FROM {{prefix}}job_blocker jb STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = jb.job_id WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${direction}, j.id ${direction} LIMIT ?) page STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = page.id JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = j.chain_id ORDER BY j.created_at ${direction}, j.id ${direction}`,
          { params: paramTypes, columns: dbJobRowColumns },
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
                value: lastRow.created_at as string,
                id: lastRow.id as string,
              })
            : null,
      };
    },

    listWorkers: async ({ txCtx, typeName, status, orderDirection, page }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, "startedAt") : null;
      const comparison = orderDirection === "desc" ? "<" : ">";
      const direction = orderDirection === "desc" ? "DESC" : "ASC";
      const conditions = ["TRUE"];
      const params: unknown[] = [];
      const paramTypes: DataType[] = [];
      if (typeName !== undefined) {
        conditions.push("JSON_CONTAINS(w.type_names, JSON_QUOTE(?))");
        params.push(typeName);
        paramTypes.push(t.string());
      }
      if (status !== undefined) {
        conditions.push(
          status === "live"
            ? "w.lease_until > UTC_TIMESTAMP(6)"
            : "w.lease_until <= UTC_TIMESTAMP(6)",
        );
      }
      if (cursor) {
        conditions.push(
          `(w.started_at ${comparison} ? OR (w.started_at = ? AND w.id ${comparison} ?))`,
        );
        params.push(cursor.value, cursor.value, cursor.id);
        paramTypes.push(t.string(), t.string(), workerIdDataType);
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const rows = await execute(
        txCtx,
        dynamic(
          `SELECT ${selectWorker("w")} FROM {{prefix}}worker w WHERE ${conditions.join(" AND ")} ORDER BY w.started_at ${direction}, w.id ${direction} LIMIT ?`,
          { params: paramTypes, columns: dbWorkerColumns },
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
                value: lastRow.started_at as string,
                id: lastRow.id as string,
              })
            : null,
      };
    },

    listWorkerJobs: async ({ txCtx, workerId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, "attemptAt") : null;
      const comparison = orderDirection === "desc" ? "<" : ">";
      const direction = orderDirection === "desc" ? "DESC" : "ASC";
      const conditions = ["j.status = 'running'", "j.attempt_by = ?"];
      const params: unknown[] = [workerId];
      const paramTypes: DataType[] = [workerIdDataType];
      if (cursor) {
        conditions.push(
          `(j.attempt_at ${comparison} ? OR (j.attempt_at = ? AND j.id ${comparison} ?))`,
        );
        params.push(cursor.value, cursor.value, cursor.id);
        paramTypes.push(t.string(), t.string(), jobIdDataType);
      }
      params.push(page.limit + 1);
      paramTypes.push(t.number());

      const rows = await execute(
        txCtx,
        dynamic(
          `${stateJobSelect} WHERE ${conditions.join(" AND ")} ORDER BY j.attempt_at ${direction}, j.id ${direction} LIMIT ?`,
          { params: paramTypes, columns: dbJobRowColumns },
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
                value: lastRow.attempt_at as string,
                id: lastRow.id as string,
              })
            : null,
      };
    },

    migrateToLatest: async () => {
      return createMigrator({
        migrations: createSchemaMigrations(),
        store: createMysqlMigrationStore({
          stateProvider,
          migrationTable: `${qualifiedPrefix}migration`,
          lockTable: `${qualifiedPrefix}migration_lock`,
        }),
      }).migrateToLatest();
    },

    close,
    [Symbol.asyncDispose]: close,
  };
};

/**
 * MySQL and MariaDB state adapter type. Includes `migrateToLatest` for schema migrations.
 *
 * @experimental
 */
export type MysqlStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
  TWorkerId extends string = UUID,
> = StateAdapter<TTxContext, TJobId, TWorkerId, "async"> & {
  /** Create or upgrade the schema. */
  migrateToLatest: () => Promise<MigrationResult>;
};
