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

const SCHEMA_VERSION = 1;

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
  "last_attempt_error",
  "last_attempt_at",
  "attempt_at",
  "attempt_by",
  "attempt_token",
  "chain_status",
  "chain_completed_at",
  "chain_deduplication_key",
  "chain_trace_context",
  "trace_context",
] as const;

const DB_CHAIN_COLUMNS = [
  "id",
  "type_name",
  "chain_status",
  "created_at",
  "chain_completed_at",
  "chain_deduplication_key",
  "chain_trace_context",
] as const;

const DB_TEXT_CAST_COLUMNS = new Set<string>([
  "input",
  "output",
  "last_attempt_error",
  "created_at",
  "scheduled_at",
  "completed_at",
  "last_attempt_at",
  "attempt_at",
  "chain_completed_at",
]);

const MIN_VERSIONS = { mysql: [8, 4, 0], mariadb: [11, 4, 0] } as const;

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

const shuffle = <T>(items: T[]): T[] => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

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
    lastAttemptError: parseJson(column("last_attempt_error")) as string | null,
    lastAttemptAt: parseNullableTimestamp(column("last_attempt_at")),
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

const parseVersion = (version: string): number[] =>
  (/^(\d+)\.(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number);

const isVersionAtLeast = (version: number[], minimum: readonly number[]): boolean => {
  for (let i = 0; i < minimum.length; i++) {
    if ((version[i] ?? 0) !== minimum[i]) return (version[i] ?? 0) > minimum[i];
  }
  return true;
};

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
  /** The server the adapter talks to. `migrateToLatest()` checks it against the server's version. */
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
    last_attempt_error: t["string?"](),
    last_attempt_at: t["string?"](),
    attempt_at: t["string?"](),
    attempt_by: nullableWorkerIdDataType,
    attempt_token: t["uuid?"](),
    chain_status: t["string?"](),
    chain_completed_at: t["string?"](),
    chain_deduplication_key: t["string?"](),
    chain_trace_context: t["string?"](),
    trace_context: t["string?"](),
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

  const execute = async (
    txCtx: TTxContext | undefined,
    typedSql: TypedSql,
    params: unknown[] = [],
  ): Promise<Row[]> => {
    try {
      return (await stateProvider.executeSql({
        txCtx,
        id: typedSql.id,
        sql: typedSql.sql,
        params,
        paramTypes: extractParamTypes(typedSql.params),
        columnTypes: extractColumnTypes(typedSql.columns),
        readOnly: typedSql.readOnly,
      })) as Row[];
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

  const withOwnTransaction = async <T>(
    txCtx: TTxContext | undefined,
    fn: (txCtx: TTxContext) => Promise<T>,
  ): Promise<T> => (txCtx ? fn(txCtx) : stateProvider.withTransaction(fn));

  const jobIds = (alias = "id_list") =>
    `SELECT ${alias}.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) ${alias}`;
  const workerIds = (alias = "id_list") =>
    `SELECT ${alias}.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{worker_id_type}} PATH '$')) ${alias}`;
  const tailJoin = (headAlias: string, tailAlias: string) =>
    `LEFT JOIN {{prefix}}job ${tailAlias} FORCE INDEX (PRIMARY) ON ${tailAlias}.id = (SELECT tail_lookup.id FROM {{prefix}}job tail_lookup WHERE tail_lookup.chain_id = ${headAlias}.id AND tail_lookup.chain_index > 0 ORDER BY tail_lookup.chain_index DESC LIMIT 1)`;
  const chainSelect = `SELECT ${selectJob("h", "h_")}, ${selectJob("t", "t_")} FROM {{prefix}}job h ${tailJoin("h", "t")}`;
  const stateJobSelect = `SELECT ${selectJob("j")}, ${selectChain("h", "c_")} FROM {{prefix}}job j JOIN {{prefix}}job h ON h.id = j.chain_id`;
  const scheduleExpression = (alias: string) =>
    `GREATEST(COALESCE(${alias}.scheduled_at, UTC_TIMESTAMP(6) + INTERVAL ROUND(${alias}.schedule_after_ms * 1000) MICROSECOND, UTC_TIMESTAMP(6)), UTC_TIMESTAMP(6))`;

  const readChains = async (
    txCtx: TTxContext | undefined,
    chainIds: string[],
  ): Promise<Map<string, StateChain>> => {
    const rows = await execute(
      txCtx,
      prepared("getChains", `${chainSelect} WHERE h.id IN (${jobIds()}) AND h.chain_index = 0`, {
        params: [t.string()],
        columns: dbChainRowColumns,
        readOnly: true,
      }),
      [JSON.stringify(chainIds)],
    );
    return new Map(rows.map((row) => [row.h_id as string, mapDbChainRowToStateChain(row)]));
  };

  const readStateJobs = async (
    txCtx: TTxContext | undefined,
    ids: string[],
  ): Promise<Map<string, StateJob>> => {
    const rows = await execute(
      txCtx,
      prepared("getJobs", `${stateJobSelect} WHERE j.id IN (${jobIds()})`, {
        params: [t.string()],
        columns: dbJobRowColumns,
        readOnly: true,
      }),
      [JSON.stringify(ids)],
    );
    return new Map(rows.map((row) => [row.id as string, mapDbJobRowToStateJob(row)]));
  };

  const lockJobsForWrite = async (
    txCtx: TTxContext,
    ids: string[],
  ): Promise<Map<string, { chainId: string; status: string; attemptToken: string | null }>> => {
    const rows = await execute(
      txCtx,
      prepared(
        "lockJobsForWrite",
        `SELECT j.id, j.chain_id, j.status, j.attempt_token FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id WHERE {{fence_guard}} {{for_update:j}}`,
        {
          params: [t.string()],
          columns: {
            id: jobIdDataType,
            chain_id: jobIdDataType,
            status: t.string(),
            attempt_token: t["uuid?"](),
          },
        },
      ),
      [sortedIdsParam(ids)],
    );
    return new Map(
      rows.map((row) => [
        row.id as string,
        {
          chainId: row.chain_id as string,
          status: row.status as string,
          attemptToken: (row.attempt_token as string | null) ?? null,
        },
      ]),
    );
  };

  const releaseBlockedDependents = async (txCtx: TTxContext, dependentIds: string[]) => {
    const lockedRows = await execute(
      txCtx,
      prepared(
        "lockBlockedDependents",
        `SELECT j.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id WHERE j.status = 'blocked' {{for_update:j}}`,
        { params: [t.string()], columns: { id: jobIdDataType } },
      ),
      [sortedIdsParam(dependentIds)],
    );
    if (lockedRows.length === 0) return;
    const releasedRows = await execute(
      txCtx,
      prepared(
        "findReleasedDependents",
        `
SELECT d.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
WHERE NOT EXISTS (
  SELECT 1 FROM {{prefix}}job_blocker jb
  LEFT JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = jb.blocked_by_chain_id
  WHERE jb.job_id = d.id AND NOT (h.chain_status <=> 'completed')
)`,
        { params: [t.string()], columns: { id: jobIdDataType } },
      ),
      [sortedIdsParam(lockedRows.map((row) => row.id as string))],
    );
    if (releasedRows.length === 0) return;
    await execute(
      txCtx,
      prepared(
        "releaseDependents",
        `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id
SET j.status = 'pending',
  j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6))
WHERE j.status = 'blocked' AND {{fence_guard}}`,
        { params: [t.string()] },
      ),
      [sortedIdsParam(releasedRows.map((row) => row.id as string))],
    );
  };

  const isWritable = (
    locked: { status: string; attemptToken: string | null } | undefined,
    attemptToken: string | undefined,
  ): boolean =>
    locked !== undefined &&
    locked.status !== "completed" &&
    (attemptToken === undefined ||
      (locked.status === "running" && locked.attemptToken === attemptToken));

  const readWorkerById = async (
    txCtx: TTxContext | undefined,
    workerId: string,
  ): Promise<StateWorkerInfo | undefined> => {
    const [row] = await execute(
      txCtx,
      prepared("getWorker", `SELECT ${selectWorker("w")} FROM {{prefix}}worker w WHERE w.id = ?`, {
        params: [workerIdDataType],
        columns: dbWorkerColumns,
      }),
      [workerId],
    );
    return row ? mapDbWorkerToStateWorkerInfo(row) : undefined;
  };

  const assertServerSupported = async (): Promise<void> => {
    const [row] = await execute(
      undefined,
      prepared(
        "serverInfo",
        "SELECT VERSION() AS version, @@SESSION.sql_mode AS sql_mode, DATABASE() AS current_database",
        {
          columns: { version: t.string(), sql_mode: t.string(), current_database: t["string?"]() },
          readOnly: true,
        },
      ),
    );
    const version = String(row.version);
    const serverDialect = /mariadb/i.test(version) ? "mariadb" : "mysql";
    if (serverDialect !== dialect) {
      throw new Error(
        `The adapter was created with dialect "${dialect}", but the server is ${serverDialect} (${version})`,
      );
    }
    if (!isVersionAtLeast(parseVersion(version), MIN_VERSIONS[dialect])) {
      throw new Error(
        `Unsupported ${dialect} version ${version}: Queuert needs ${MIN_VERSIONS[dialect].join(".")} or later`,
      );
    }
    if (row.current_database == null) {
      throw new Error(
        "The connection has no default database: connect with a database selected, as MySQL rejects multi-table updates over JSON_TABLE without one",
      );
    }
    if (/NO_BACKSLASH_ESCAPES/.test(String(row.sql_mode))) {
      throw new Error(
        `The session sql_mode "${String(row.sql_mode)}" includes NO_BACKSLASH_ESCAPES: remove it, as drivers escape the parameters of text-protocol statements with backslashes`,
      );
    }
    if (!/STRICT_(TRANS|ALL)_TABLES/.test(String(row.sql_mode))) {
      throw new Error(
        `The session sql_mode "${String(row.sql_mode)}" is not strict: enable STRICT_TRANS_TABLES so the server rejects values it would otherwise truncate`,
      );
    }
  };

  const createSchemaMigrations = (): Migration<TTxContext>[] => [
    {
      name: "001_initial_schema",
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
        const chains = await readChains(txCtx, chainIds);
        return chainIds.map((id) => chains.get(id));
      }
      const sortedChainIds = JSON.stringify([...new Set(chainIds)].sort());
      if (dialect === "mariadb") {
        await execute(
          txCtx,
          prepared(
            "lockChainHeads",
            `SELECT h.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id WHERE h.chain_index = 0 {{for_update:h}}`,
            { params: [t.string()], columns: { id: jobIdDataType } },
          ),
          [sortedChainIds],
        );
        const chains = await readChains(txCtx, chainIds);
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
        const jobs = await readStateJobs(txCtx, ids);
        return ids.map((id) => jobs.get(id));
      }
      const rows = await execute(
        txCtx,
        prepared(
          "getJobsLocked",
          `SELECT ${selectJob("j")}, ${selectChain("h", "c_")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = j.chain_id {{for_update:j:h}}`,
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
              `SELECT ${selectWorker("w")} FROM {{prefix}}worker w WHERE w.id IN (${workerIds()})`,
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
        await execute(
          txCtx,
          prepared(
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
          [
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
        );
        const rows = await execute(
          txCtx,
          prepared(
            "readCreatedJobs",
            `SELECT ${selectJob("h", "h_")} FROM {{prefix}}job h WHERE h.id IN (${jobIds()})`,
            { params: [t.string()], columns: prefixColumns(dbJobColumns, "h_") },
          ),
          [JSON.stringify(inserted.map((job) => job.id))],
        );
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

      await execute(
        txCtx,
        prepared(
          "completeContinuedJobs",
          `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (${continuationColumns})) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.continue_from_id
SET j.status = 'completed',
  j.completed_at = UTC_TIMESTAMP(6),
  j.completed_by = d.worker_id,
  j.continued_to_id = d.new_id,
  j.output = NULL,
  j.last_attempt_error = NULL,
  j.attempt_at = NULL,
  j.attempt_by = NULL,
  j.attempt_token = NULL
WHERE j.status <> 'completed'
  AND (d.attempt_token IS NULL OR (j.status = 'running' AND j.attempt_token = d.attempt_token))
  AND {{fence_guard}}`,
          { params: [t.string()] },
        ),
        [continuations],
      );
      await execute(
        txCtx,
        prepared(
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
        [continuations, continuations],
      );
      const rows = await execute(
        txCtx,
        prepared(
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
        [continuations],
      );
      const rowByContinuationId = new Map(rows.map((row) => [row.continuation_id as string, row]));
      return jobs.map((job) => {
        const row = rowByContinuationId.get(job.id);
        if (!row) return undefined;
        return { ...mapDbJobRowToStateJob(row), continuation: mapDbJobToStateJobInfo(row, "n_")! };
      });
    },

    completeJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];
      const locked = await lockJobsForWrite(
        txCtx,
        jobs.map((job) => job.jobId),
      );
      const writable = jobs.filter((job) => isWritable(locked.get(job.jobId), job.attemptToken));
      if (writable.length === 0) return jobs.map(() => undefined);

      await execute(
        txCtx,
        prepared(
          "completeJobs",
          `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (
  job_id {{job_id_type}} PATH '$.job_id',
  output LONGTEXT CHARACTER SET utf8mb4 PATH '$.output',
  worker_id {{worker_id_type}} PATH '$.worker_id'
)) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.job_id
SET j.chain_status = CASE WHEN j.id = j.chain_id THEN 'completed' ELSE j.chain_status END,
  j.chain_completed_at = CASE WHEN j.id = j.chain_id AND j.chain_completed_at IS NULL THEN UTC_TIMESTAMP(6) ELSE j.chain_completed_at END,
  j.status = 'completed',
  j.last_attempt_error = NULL,
  j.attempt_at = NULL,
  j.attempt_by = NULL,
  j.attempt_token = NULL,
  j.completed_at = UTC_TIMESTAMP(6),
  j.completed_by = d.worker_id,
  j.output = JSON_EXTRACT(d.output, '$')
WHERE {{fence_guard}}`,
          { params: [t.string()] },
        ),
        [
          toJsonParam(
            [...writable].sort(compareBy((job) => job.jobId)).map((job) => ({
              job_id: job.jobId,
              output: stringifyOptional(job.output),
              worker_id: job.workerId,
            })),
          ),
        ],
      );

      const continuationHeadIds = writable
        .map((job) => locked.get(job.jobId)!.chainId)
        .filter((chainId, index) => chainId !== writable[index].jobId);
      if (continuationHeadIds.length > 0) {
        await execute(
          txCtx,
          prepared(
            "completeChainHeads",
            `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d
STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id
SET h.chain_status = 'completed',
  h.chain_completed_at = COALESCE(h.chain_completed_at, UTC_TIMESTAMP(6))
WHERE {{fence_guard}}`,
            { params: [t.string()] },
          ),
          [sortedIdsParam(continuationHeadIds)],
        );
      }
      const completed = await readStateJobs(
        txCtx,
        writable.map((job) => job.jobId),
      );
      return jobs.map((job) => completed.get(job.jobId));
    },

    rescheduleJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];
      return withOwnTransaction(txCtx, async (txCtx) => {
        const locked = await lockJobsForWrite(
          txCtx,
          jobs.map((job) => job.jobId),
        );
        const writable = jobs.filter((job) => isWritable(locked.get(job.jobId), job.attemptToken));
        if (writable.length === 0) return jobs.map(() => undefined);

        await execute(
          txCtx,
          prepared(
            "rescheduleJobs",
            `
UPDATE JSON_TABLE(?, '$[*]' COLUMNS (
  job_id {{job_id_type}} PATH '$.job_id',
  was_running INT PATH '$.was_running',
  scheduled_at DATETIME(6) PATH '$.scheduled_at',
  schedule_after_ms DOUBLE PATH '$.schedule_after_ms',
  error LONGTEXT CHARACTER SET utf8mb4 PATH '$.error'
)) d
STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.job_id
SET j.last_attempt_at = CASE WHEN d.was_running = 1 THEN UTC_TIMESTAMP(6) ELSE j.last_attempt_at END,
  j.last_attempt_error = CASE WHEN d.was_running = 1 THEN JSON_EXTRACT(d.error, '$') ELSE j.last_attempt_error END,
  j.status = CASE WHEN d.was_running = 1 THEN 'pending' ELSE j.status END,
  j.scheduled_at = ${scheduleExpression("d")},
  j.attempt_at = NULL,
  j.attempt_by = NULL,
  j.attempt_token = NULL
WHERE {{fence_guard}}`,
            { params: [t.string()] },
          ),
          [
            toJsonParam(
              [...writable].sort(compareBy((job) => job.jobId)).map((job) => ({
                job_id: job.jobId,
                was_running: locked.get(job.jobId)!.status === "running" ? 1 : 0,
                scheduled_at: job.schedule?.at ? formatTimestamp(job.schedule.at) : undefined,
                schedule_after_ms: job.schedule?.afterMs,
                error: stringifyOptional(job.error),
              })),
            ),
          ],
        );
        const rescheduled = await readStateJobs(
          txCtx,
          writable.map((job) => job.jobId),
        );
        return jobs.map((job) => rescheduled.get(job.jobId));
      });
    },

    deleteChains: async ({ txCtx, chainIds }) => {
      if (chainIds.length === 0) return [];
      const chainIdsParam = sortedIdsParam(chainIds);
      const members = await execute(
        txCtx,
        prepared(
          "lockDeletedChains",
          `SELECT j.id FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX ({{name_prefix}}chain_index_idx) ON j.chain_id = d.id {{for_update:j}}`,
          { params: [t.string()], columns: { id: jobIdDataType } },
        ),
        [chainIdsParam],
      );
      const externalRefs = await execute(
        txCtx,
        prepared(
          "findExternalBlockerRefs",
          `
SELECT jb.job_id AS b_job_id, jb.blocked_by_chain_id AS b_blocked_by_chain_id, jb.\`index\` AS b_index, jb.trace_context AS b_trace_context, ${selectJob("j")}
FROM {{prefix}}job_blocker jb
JOIN {{prefix}}job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id IN (${jobIds("blocker_list")})
  AND j.chain_id NOT IN (${jobIds("member_list")})
ORDER BY jb.job_id, jb.\`index\``,
          { params: [t.string(), t.string()], columns: { ...dbBlockerColumns, ...dbJobColumns } },
        ),
        [chainIdsParam, chainIdsParam],
      );
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

      const chains = await readChains(txCtx, chainIds);
      if (members.length > 0) {
        const memberIdsParam = JSON.stringify(members.map((row) => row.id));
        await execute(
          txCtx,
          prepared(
            "deleteChainBlockers",
            `DELETE FROM {{prefix}}job_blocker WHERE job_id IN (${jobIds()})`,
            { params: [t.string()] },
          ),
          [memberIdsParam],
        );
        await execute(
          txCtx,
          prepared("deleteChainJobs", `DELETE FROM {{prefix}}job WHERE id IN (${jobIds()})`, {
            params: [t.string()],
          }),
          [memberIdsParam],
        );
      }
      return chainIds.map((chainId) => chains.get(chainId));
    },

    startJobAttempts: async ({ txCtx, typeNames, workerId, workerToken, limit }) =>
      withOwnTransaction(txCtx, async (txCtx) => {
        const [liveWorker] = await execute(
          txCtx,
          prepared(
            "lockLiveWorker",
            `SELECT id FROM {{prefix}}worker WHERE id = ? AND token = ? AND lease_until > UTC_TIMESTAMP(6) AND {{fence_guard}} LOCK IN SHARE MODE`,
            { params: [workerIdDataType, t.uuid()], columns: { id: workerIdDataType } },
          ),
          [workerId, workerToken],
        );
        if (!liveWorker) return [];

        const pickedIds: string[] = [];
        for (const typeName of shuffle(typeNames)) {
          if (pickedIds.length >= limit) break;
          const rows = await execute(
            txCtx,
            prepared(
              "pickPendingJobs",
              `
SELECT id FROM {{prefix}}job FORCE INDEX ({{name_prefix}}job_status_idx)
WHERE type_name = ? AND status = 'pending' AND status_ts <= UTC_TIMESTAMP(6)
ORDER BY status_ts
LIMIT ?
FOR UPDATE SKIP LOCKED`,
              { params: [t.string(), t.number()], columns: { id: jobIdDataType } },
            ),
            [typeName, limit - pickedIds.length],
          );
          pickedIds.push(...rows.map((row) => row.id as string));
        }
        if (pickedIds.length === 0) return [];

        await execute(
          txCtx,
          prepared(
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
          [JSON.stringify(pickedIds.map((id) => ({ id, attempt_token: randomUUID() }))), workerId],
        );
        const rows = await execute(
          txCtx,
          prepared(
            "readClaimedJobs",
            `
SELECT ${selectJob("j")}, ${selectChain("h", "c_")},
  EXISTS (SELECT 1 FROM {{prefix}}job_blocker jb WHERE jb.job_id = j.id) AS has_blockers
FROM {{prefix}}job j
JOIN {{prefix}}job h ON h.id = j.chain_id
WHERE j.id IN (${jobIds()})`,
            { params: [t.string()], columns: { ...dbJobRowColumns, has_blockers: t.number() } },
          ),
          [JSON.stringify(pickedIds)],
        );
        return rows.map((row) => ({
          ...mapDbJobRowToStateJob(row),
          hasBlockers: toBoolean(row.has_blockers),
        }));
      }),

    getStartAttemptDelayMs: async ({ txCtx, typeNames }) => {
      if (typeNames.length === 0) return null;
      const branch = `(SELECT status_ts FROM {{prefix}}job FORCE INDEX ({{name_prefix}}job_status_idx) WHERE type_name = ? AND status = 'pending' AND status_ts > UTC_TIMESTAMP(6) ORDER BY status_ts LIMIT 1)`;
      const [upcoming] = await execute(
        txCtx,
        dynamic(
          `SELECT CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), MIN(upcoming.status_ts)) / 1000) AS delay_ms FROM (${typeNames.map(() => branch).join(" UNION ALL ")}) upcoming`,
          { params: typeNames.map(() => t.string()), columns: { delay_ms: t["number?"]() } },
        ),
        typeNames,
      );
      for (const typeName of typeNames) {
        const [due] = await execute(
          txCtx,
          prepared(
            "probeDueJob",
            `
SELECT id FROM {{prefix}}job FORCE INDEX ({{name_prefix}}job_status_idx)
WHERE type_name = ? AND status = 'pending' AND status_ts <= UTC_TIMESTAMP(6)
ORDER BY status_ts
LIMIT 1
FOR UPDATE SKIP LOCKED`,
            { params: [t.string()], columns: { id: jobIdDataType } },
          ),
          [typeName],
        );
        if (due) return 0;
      }
      return upcoming?.delay_ms == null ? null : Math.max(0, Number(upcoming.delay_ms));
    },

    addJobsBlockers: async ({ txCtx, jobBlockers }) => {
      if (jobBlockers.length === 0) return [];

      const blockerChainIds = [...new Set(jobBlockers.flatMap((entry) => entry.blockedByChainIds))];
      const headRows = await execute(
        txCtx,
        prepared(
          "lockBlockerHeads",
          `SELECT ${selectJob("h", "h_")} FROM JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job h FORCE INDEX (PRIMARY) ON h.id = d.id WHERE h.chain_index = 0 AND {{fence_guard}} {{for_update:h}}`,
          { params: [t.string()], columns: prefixColumns(dbJobColumns, "h_") },
        ),
        [sortedIdsParam(blockerChainIds)],
      );
      const blockerChains = new Map(
        headRows.map((row) => [row.h_id as string, mapDbHeadToStateChainInfo(row, "h_")]),
      );

      const blockerRows = jobBlockers.flatMap(
        ({ jobId, blockedByChainIds, blockerTraceContexts }) =>
          blockedByChainIds.flatMap((blockedByChainId, index) =>
            blockerChains.has(blockedByChainId)
              ? [
                  {
                    job_id: jobId,
                    blocked_by_chain_id: blockedByChainId,
                    index,
                    trace_context: blockerTraceContexts?.[index] ?? undefined,
                  },
                ]
              : [],
          ),
      );
      if (blockerRows.length > 0) {
        await execute(
          txCtx,
          prepared(
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
WHERE {{fence_guard}}`,
            { params: [t.string()] },
          ),
          [toJsonParam(blockerRows)],
        );
      }

      const blockedJobIds = blockerRows
        .filter((row) => blockerChains.get(row.blocked_by_chain_id)!.status === "running")
        .map((row) => row.job_id);
      if (blockedJobIds.length > 0) {
        await execute(
          txCtx,
          prepared(
            "blockDependents",
            `UPDATE JSON_TABLE(?, '$[*]' COLUMNS (id {{job_id_type}} PATH '$')) d STRAIGHT_JOIN {{prefix}}job j FORCE INDEX (PRIMARY) ON j.id = d.id SET j.status = 'blocked' WHERE j.status = 'pending' AND {{fence_guard}}`,
            { params: [t.string()] },
          ),
          [sortedIdsParam(blockedJobIds)],
        );
      }

      const dependents = await readStateJobs(
        txCtx,
        jobBlockers.map((entry) => entry.jobId),
      );
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
      const dependentRows = await execute(
        txCtx,
        prepared(
          "findDependents",
          `SELECT DISTINCT job_id FROM {{prefix}}job_blocker WHERE blocked_by_chain_id = ? AND {{fence_guard}} ORDER BY job_id`,
          { params: [jobIdDataType], columns: { job_id: jobIdDataType } },
        ),
        [blockedByChainId],
      );
      if (dependentRows.length === 0) return [];
      await releaseBlockedDependents(
        txCtx,
        dependentRows.map((row) => row.job_id as string),
      );
      const rows = await execute(
        txCtx,
        prepared(
          "readDependents",
          `
SELECT jb.job_id AS b_job_id, jb.blocked_by_chain_id AS b_blocked_by_chain_id, jb.\`index\` AS b_index, jb.trace_context AS b_trace_context, ${selectJob("j")}, ${selectChain("h", "c_")}
FROM {{prefix}}job_blocker jb
JOIN {{prefix}}job j ON j.id = jb.job_id
JOIN {{prefix}}job h ON h.id = j.chain_id
WHERE jb.blocked_by_chain_id = ?
ORDER BY jb.job_id, jb.\`index\``,
          { params: [jobIdDataType], columns: { ...dbBlockerColumns, ...dbJobRowColumns } },
        ),
        [blockedByChainId],
      );
      return rows.map((row): StateDependentJob =>
        mapDbBlockerRowToStateBlockedJob(row, mapDbJobRowToStateJob(row)),
      );
    },

    startWorker: async ({ txCtx, workerId, typeNames, concurrency, leaseMs }) => {
      await execute(
        txCtx,
        prepared(
          "startWorker",
          `
INSERT INTO {{prefix}}worker (id, type_names, concurrency, started_at, lease_until, token)
SELECT ?, JSON_EXTRACT(?, '$'), ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL ROUND(? * 1000) MICROSECOND, ?
FROM DUAL
WHERE {{fence_guard}}`,
          { params: [workerIdDataType, t.string(), t.number(), t.number(), t.uuid()] },
        ),
        [workerId, JSON.stringify(typeNames), concurrency, leaseMs, randomUUID()],
      );
      return (await readWorkerById(txCtx, workerId))!;
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
        await execute(
          txCtx,
          prepared(
            "extendWorkerLease",
            `UPDATE {{prefix}}worker SET lease_until = UTC_TIMESTAMP(6) + INTERVAL ROUND(? * 1000) MICROSECOND WHERE id = ? AND {{fence_guard}}`,
            { params: [t.number(), workerIdDataType] },
          ),
          [leaseMs, workerId],
        );
        return readWorkerById(txCtx, workerId);
      }),

    stopWorker: async ({ txCtx, workerId, workerToken }) =>
      withOwnTransaction(txCtx, async (txCtx) => {
        const [row] = await execute(
          txCtx,
          prepared(
            "lockStoppedWorker",
            `SELECT ${selectWorker("w")} FROM {{prefix}}worker w WHERE w.id = ? AND w.token = ? FOR UPDATE`,
            { params: [workerIdDataType, t.uuid()], columns: dbWorkerColumns },
          ),
          [workerId, workerToken],
        );
        if (!row) return undefined;
        await execute(
          txCtx,
          prepared("stopWorker", `DELETE FROM {{prefix}}worker WHERE id = ?`, {
            params: [workerIdDataType],
          }),
          [workerId],
        );
        return mapDbWorkerToStateWorkerInfo(row);
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
      independent,
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
      if (independent !== undefined) {
        conditions.push(
          `(SELECT 1 FROM {{prefix}}job_blocker jb WHERE jb.blocked_by_chain_id = h.id LIMIT 1) IS ${independent ? "" : "NOT "}NULL`,
        );
      }
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
        orderColumn === "created_at"
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
      await assertServerSupported();
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
> = StateAdapter<TTxContext, TJobId, TWorkerId> & {
  /**
   * Check the server, then create or upgrade the schema.
   *
   * @throws Error if the server does not match `dialect`, is below the minimum version, runs
   * without a strict `sql_mode`, or the connection has no default database.
   */
  migrateToLatest: () => Promise<MigrationResult>;
};
