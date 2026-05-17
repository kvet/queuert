import {
  type DataType,
  type Migration,
  type RuntimeType,
  type TypedSql,
  sql,
  t,
} from "@queuert/typed-sql";

export const jobColumns = [
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

export const jobColumnsSelect = (alias: string): string =>
  jobColumns.map((c) => `${alias}.${c}`).join(", ");

export const jobColumnsPrefixedSelect = (alias: string, prefix: string): string =>
  jobColumns.map((c) => `${alias}.${c} AS ${prefix}${c}`).join(", ");

export type DbJob = {
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

export type DbChainRow = DbJob & {
  [K in keyof DbJob as `lc_${K}`]: DbJob[K] | null;
};

export const migrations: Migration[] = [
  {
    name: "20240101000000_initial_schema",
    transactional: true,
    statements: [
      {
        sql: sql(/* sql */ `
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
        sql: sql(/* sql */ `
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
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_acquisition_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      },
      {
        sql: sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}job_chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_expired_lease_idx
ON {{table_prefix}}job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_idx
ON {{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_idx
ON {{table_prefix}}job (created_at DESC)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_status_idx
ON {{table_prefix}}job (status, created_at DESC)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_type_name_idx
ON {{table_prefix}}job (type_name, created_at DESC)`),
      },
      {
        sql: sql(/* sql */ `
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
        sql: sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_chain_index_idx`),
      },
      {
        sql: sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}chain_index_idx
ON {{table_prefix}}job (chain_id, chain_index)`),
      },
      {
        sql: sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_chain_listing_idx`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_listing_idx
ON {{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      },
      {
        sql: sql(/* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_chain_listing_type_name_idx`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_listing_type_name_idx
ON {{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Column type aliases (used to annotate SqliteSqlDefinitions)
// ---------------------------------------------------------------------------

type Id<TRuntime extends RuntimeType> = DataType<TRuntime, string>;

type SqliteDbJobCols<TRuntime extends RuntimeType> = {
  readonly id: Id<TRuntime>;
  readonly chain_id: Id<TRuntime>;
  readonly type_name: DataType<"string", string>;
  readonly chain_type_name: DataType<"string", string>;
  readonly chain_index: DataType<"number", number>;
  readonly input: DataType<"string?", string | null>;
  readonly output: DataType<"string?", string | null>;
  readonly status: DataType<"string", DbJob["status"]>;
  readonly created_at: DataType<"string", string>;
  readonly scheduled_at: DataType<"string", string>;
  readonly completed_at: DataType<"string?", string | null>;
  readonly completed_by: DataType<"string?", string | null>;
  readonly attempt: DataType<"number", number>;
  readonly last_attempt_error: DataType<"string?", string | null>;
  readonly last_attempt_at: DataType<"string?", string | null>;
  readonly leased_by: DataType<"string?", string | null>;
  readonly leased_until: DataType<"string?", string | null>;
  readonly deduplication_key: DataType<"string?", string | null>;
  readonly chain_trace_context: DataType<"string?", string | null>;
  readonly trace_context: DataType<"string?", string | null>;
};

type SqliteDbChainRowCols<TRuntime extends RuntimeType> = SqliteDbJobCols<TRuntime> & {
  readonly lc_id: DataType<"string?", string | null>;
  readonly lc_type_name: DataType<"string?", string | null>;
  readonly lc_chain_id: DataType<"string?", string | null>;
  readonly lc_chain_type_name: DataType<"string?", string | null>;
  readonly lc_chain_index: DataType<"number?", number | null>;
  readonly lc_input: DataType<"string?", string | null>;
  readonly lc_output: DataType<"string?", string | null>;
  readonly lc_status: DataType<"string?", DbJob["status"] | null>;
  readonly lc_created_at: DataType<"string?", string | null>;
  readonly lc_scheduled_at: DataType<"string?", string | null>;
  readonly lc_completed_at: DataType<"string?", string | null>;
  readonly lc_completed_by: DataType<"string?", string | null>;
  readonly lc_attempt: DataType<"number?", number | null>;
  readonly lc_last_attempt_error: DataType<"string?", string | null>;
  readonly lc_last_attempt_at: DataType<"string?", string | null>;
  readonly lc_leased_by: DataType<"string?", string | null>;
  readonly lc_leased_until: DataType<"string?", string | null>;
  readonly lc_deduplication_key: DataType<"string?", string | null>;
  readonly lc_chain_trace_context: DataType<"string?", string | null>;
  readonly lc_trace_context: DataType<"string?", string | null>;
};

// ---------------------------------------------------------------------------
// SqliteSqlDefinitions — explicit return type for createSqliteSqlDefinitions
// ---------------------------------------------------------------------------

export type SqliteSqlDefinitions<TRuntime extends RuntimeType = RuntimeType> = {
  readonly dbJobColumns: SqliteDbJobCols<TRuntime>;
  readonly dbChainRowColumns: SqliteDbChainRowCols<TRuntime>;
  readonly createMigrationTableSql: TypedSql<readonly [], Record<string, never>>;
  readonly getAppliedMigrationsSql: TypedSql<
    readonly [],
    { readonly name: DataType<"string", string>; readonly applied_at: DataType<"string", string> }
  >;
  readonly recordMigrationSql: TypedSql<
    readonly [DataType<"string", string>],
    Record<string, never>
  >;
  readonly findExistingContinuationSql: TypedSql<
    readonly [Id<TRuntime>, DataType<"number", number>],
    SqliteDbJobCols<TRuntime> & { readonly deduplicated: DataType<"number", number> }
  >;
  readonly findDeduplicatedJobSql: TypedSql<
    readonly [
      DataType<"string?", string | null>,
      DataType<"string?", string | null>,
      DataType<"string", string>,
      DataType<"string?", string | null>,
      DataType<"string?", string | null>,
      DataType<"string?", string | null>,
      DataType<"number?", number | null>,
      DataType<"number?", number | null>,
      DataType<"string?", string | null>,
      DataType<"string?", string | null>,
    ],
    SqliteDbJobCols<TRuntime> & { readonly deduplicated: DataType<"number", number> }
  >;
  readonly insertJobsSql: TypedSql<
    readonly [DataType<"string", string>],
    SqliteDbJobCols<TRuntime>
  >;
  readonly insertJobBlockersSql: TypedSql<
    readonly [Id<TRuntime>, DataType<"string", string>, DataType<"string", string>],
    Record<string, never>
  >;
  readonly checkBlockersStatusSql: TypedSql<
    readonly [Id<TRuntime>],
    {
      readonly job_id: Id<TRuntime>;
      readonly blocked_by_chain_id: Id<TRuntime>;
      readonly blocker_status: DataType<"string", string>;
    }
  >;
  readonly updateJobToBlockedSql: TypedSql<readonly [Id<TRuntime>], SqliteDbJobCols<TRuntime>>;
  readonly getJobForBlockersSql: TypedSql<readonly [Id<TRuntime>], SqliteDbJobCols<TRuntime>>;
  readonly completeJobSql: TypedSql<
    readonly [DataType<"string?", string | null>, DataType<"string?", string | null>, Id<TRuntime>],
    SqliteDbJobCols<TRuntime>
  >;
  readonly findReadyJobsSql: TypedSql<readonly [Id<TRuntime>], { readonly job_id: Id<TRuntime> }>;
  readonly scheduleBlockedJobsSql: TypedSql<
    readonly [DataType<"string", string>],
    SqliteDbJobCols<TRuntime>
  >;
  readonly getJobBlockerTraceContextsSql: TypedSql<
    readonly [Id<TRuntime>],
    { readonly trace_context: DataType<"string?", string | null> }
  >;
  readonly getBlockerChainTraceContextsSql: TypedSql<
    readonly [DataType<"string", string>],
    {
      readonly blocked_by_chain_id: Id<TRuntime>;
      readonly chain_trace_context: DataType<"string?", string | null>;
    }
  >;
  readonly getChainSql: TypedSql<
    readonly [Id<TRuntime>, Id<TRuntime>],
    SqliteDbChainRowCols<TRuntime>
  >;
  readonly getJobBlockersSql: TypedSql<readonly [Id<TRuntime>], SqliteDbChainRowCols<TRuntime>>;
  readonly getJobSql: TypedSql<readonly [Id<TRuntime>], SqliteDbJobCols<TRuntime>>;
  readonly getJobLockedSql: TypedSql<readonly [Id<TRuntime>], SqliteDbJobCols<TRuntime>>;
  readonly lockLatestChainJobSql: TypedSql<readonly [Id<TRuntime>], Record<string, never>>;
  readonly rescheduleJobSql: TypedSql<
    readonly [
      DataType<"string?", string | null>,
      DataType<"number?", number | null>,
      DataType<"number?", number | null>,
      DataType<"string", string>,
      Id<TRuntime>,
    ],
    SqliteDbJobCols<TRuntime>
  >;
  readonly triggerJobsSql: TypedSql<
    readonly [DataType<"string", string>],
    SqliteDbJobCols<TRuntime>
  >;
  readonly getJobStatusesByIdsSql: TypedSql<
    readonly [DataType<"string", string>],
    { readonly id: Id<TRuntime>; readonly status: DataType<"string", string> }
  >;
  readonly renewJobLeaseSql: TypedSql<
    readonly [DataType<"string", string>, DataType<"number", number>, Id<TRuntime>],
    SqliteDbJobCols<TRuntime>
  >;
  readonly acquireJobSql: TypedSql<
    readonly [DataType<"string", string>, DataType<"string", string>],
    SqliteDbJobCols<TRuntime> & { readonly has_more: DataType<"number", number> }
  >;
  readonly getNextJobAvailableInMsSql: TypedSql<
    readonly [DataType<"string", string>],
    { readonly available_in_ms: DataType<"number", number> }
  >;
  readonly reapExpiredJobLeaseSql: TypedSql<
    readonly [DataType<"string", string>, DataType<"string", string>],
    SqliteDbJobCols<TRuntime>
  >;
  readonly getConnectedChainIdsSql: TypedSql<
    readonly [DataType<"string", string>],
    { readonly chain_id: Id<TRuntime> }
  >;
  readonly checkExternalBlockerRefsSql: TypedSql<
    readonly [DataType<"string", string>, DataType<"string", string>],
    { readonly job_id: Id<TRuntime>; readonly blocked_by_chain_id: Id<TRuntime> }
  >;
  readonly deleteBlockersByChainIdsSql: TypedSql<
    readonly [DataType<"string", string>],
    Record<string, never>
  >;
  readonly getChainsByChainIdsSql: TypedSql<
    readonly [DataType<"string", string>],
    SqliteDbChainRowCols<TRuntime>
  >;
  readonly deleteChainsSql: TypedSql<readonly [DataType<"string", string>], Record<string, never>>;
};

export const createSqliteSqlDefinitions = <TRuntime extends RuntimeType>(
  id: DataType<TRuntime, string>,
): SqliteSqlDefinitions<TRuntime> => {
  const dbJobColumns = {
    id,
    chain_id: id,
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

  const createMigrationTableSql = sql(
    /* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}migration (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
)`,
    {
      id: "createMigrationTable",
      params: [],
      columns: {},
    },
  );

  const getAppliedMigrationsSql = sql(
    /* sql */ `SELECT name, applied_at FROM {{table_prefix}}migration ORDER BY name`,
    {
      id: "getAppliedMigrations",
      params: [],
      columns: { name: t.string(), applied_at: t.string() },
      readOnly: true,
    },
  );

  const recordMigrationSql = sql(
    /* sql */ `INSERT INTO {{table_prefix}}migration (name) VALUES (?) ON CONFLICT (name) DO NOTHING`,
    {
      id: "recordMigration",
      params: [t.string()],
      columns: {},
    },
  );

  const findExistingContinuationSql = sql(
    /* sql */ `
SELECT *, 1 AS deduplicated
FROM {{table_prefix}}job
WHERE chain_id = ? AND chain_index = ? AND id != chain_id
LIMIT 1
`,
    {
      id: "findExistingContinuation",
      params: [id, t.number()],
      columns: { ...dbJobColumns, deduplicated: t.number() },
      readOnly: true,
    },
  );

  const findDeduplicatedJobSql = sql(
    /* sql */ `
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
  );

  const insertJobsSql = sql(
    /* sql */ `
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_type_name, chain_index, input, deduplication_key, scheduled_at, chain_trace_context, trace_context)
SELECT
  json_extract(je.value, '$.id'),
  json_extract(je.value, '$.type_name'),
  COALESCE(json_extract(je.value, '$.chain_id'), json_extract(je.value, '$.id')),
  json_extract(je.value, '$.chain_type_name'),
  json_extract(je.value, '$.chain_index'),
  json_extract(je.value, '$.input'),
  json_extract(je.value, '$.deduplication_key'),
  COALESCE(
    json_extract(je.value, '$.scheduled_at'),
    CASE WHEN json_extract(je.value, '$.schedule_after_ms') IS NOT NULL
      THEN datetime('now', 'subsec', '+' || (json_extract(je.value, '$.schedule_after_ms') / 1000.0) || ' seconds')
      ELSE NULL
    END,
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
  );

  const insertJobBlockersSql = sql(
    /* sql */ `
INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT ?, je.value, je.key, json_extract(?, '$[' || je.key || ']')
FROM json_each(?) AS je
`,
    {
      id: "insertJobBlockers",
      params: [id, t.string(), t.string()],
      columns: {},
    },
  );

  const checkBlockersStatusSql = sql(
    /* sql */ `
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
      params: [id],
      columns: { job_id: id, blocked_by_chain_id: id, blocker_status: t.string() },
      readOnly: true,
    },
  );

  const updateJobToBlockedSql = sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET status = 'blocked'
WHERE id = ? AND status = 'pending'
RETURNING *
`,
    {
      id: "updateJobToBlocked",
      params: [id],
      columns: { ...dbJobColumns },
    },
  );

  const getJobForBlockersSql = sql(/* sql */ `SELECT * FROM {{table_prefix}}job WHERE id = ?`, {
    id: "getJobForBlockers",
    params: [id],
    columns: { ...dbJobColumns },
    readOnly: true,
  });

  const completeJobSql = sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET status = 'completed',
  completed_at = datetime('now', 'subsec'),
  completed_by = ?,
  output = ?,
  leased_by = NULL,
  leased_until = NULL
WHERE id = ?
RETURNING *
`,
    {
      id: "completeJob",
      params: [t["string?"](), t["string?"](), id],
      columns: { ...dbJobColumns },
    },
  );

  const findReadyJobsSql = sql(
    /* sql */ `
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
      params: [id],
      columns: { job_id: id },
      readOnly: true,
    },
  );

  const scheduleBlockedJobsSql = sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET scheduled_at = datetime('now', 'subsec'),
    status = 'pending'
WHERE id IN (SELECT value FROM json_each(?)) AND status = 'blocked'
RETURNING *
`,
    {
      id: "scheduleBlockedJobs",
      params: [t.string()],
      columns: { ...dbJobColumns },
    },
  );

  const getJobBlockerTraceContextsSql = sql(
    /* sql */ `
SELECT jb.trace_context
FROM {{table_prefix}}job_blocker jb
WHERE jb.blocked_by_chain_id = ?
  AND jb.trace_context IS NOT NULL
`,
    {
      id: "getJobBlockerTraceContexts",
      params: [id],
      columns: { trace_context: t["string?"]() },
      readOnly: true,
    },
  );

  const getBlockerChainTraceContextsSql = sql(
    /* sql */ `
SELECT j.id AS blocked_by_chain_id, j.chain_trace_context
FROM {{table_prefix}}job j
WHERE j.id IN (SELECT value FROM json_each(?))
ORDER BY j.id
`,
    {
      id: "getBlockerChainTraceContexts",
      params: [t.string()],
      columns: { blocked_by_chain_id: id, chain_trace_context: t["string?"]() },
      readOnly: true,
    },
  );

  const getChainSql = sql(
    /* sql */ `
SELECT
  {{job_columns:j}},
  {{job_columns_prefixed:lc:lc_}}
FROM {{table_prefix}}job AS j
LEFT JOIN (
  SELECT *
  FROM {{table_prefix}}job
  WHERE chain_id = ?
  ORDER BY chain_index DESC
  LIMIT 1
) AS lc ON lc.chain_id = j.id
WHERE j.id = ?
`,
    {
      id: "getChain",
      params: [id, id],
      columns: { ...dbChainRowColumns },
      readOnly: true,
    },
  );

  const getJobBlockersSql = sql(
    /* sql */ `
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
      params: [id],
      columns: { ...dbChainRowColumns },
      readOnly: true,
    },
  );

  const getJobSql = sql(
    /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE id = ?
`,
    {
      id: "getJob",
      params: [id],
      columns: { ...dbJobColumns },
      readOnly: true,
    },
  );

  // SQLite has no row-level FOR UPDATE; an UPDATE that touches the row promotes
  // the deferred transaction to RESERVED, blocking other writers (including
  // concurrent locked reads) until commit. `SET id = id` is an explicit no-op
  // write that still takes the lock. RETURNING * gives us the row in the same
  // shape as `getJobSql`, so callers can use this in place of read+lock.
  const getJobLockedSql = sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET id = id
WHERE id = ?
RETURNING *
`,
    {
      id: "getJobLocked",
      params: [id],
      columns: { ...dbJobColumns },
    },
  );

  // Promote the transaction to RESERVED on the latest job in a chain. Used
  // before `getChainSql` when callers want write-intent on the row
  // they're about to extend.
  const lockLatestChainJobSql = sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET id = id
WHERE id = (
  SELECT id FROM {{table_prefix}}job
  WHERE chain_id = ?
  ORDER BY chain_index DESC
  LIMIT 1
)
`,
    {
      id: "lockLatestChainJob",
      params: [id],
      columns: {} as Record<string, never>,
    },
  );

  const rescheduleJobSql = sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET scheduled_at = COALESCE(?,
    CASE WHEN ? IS NOT NULL THEN datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds') ELSE NULL END,
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
      params: [t["string?"](), t["number?"](), t["number?"](), t.string(), id],
      columns: { ...dbJobColumns },
    },
  );

  const triggerJobsSql = sql(
    /* sql */ `
WITH _classified AS (
  SELECT i.value AS input_id, j.id AS found_id, j.status AS current_status
  FROM json_each(?) i
  LEFT JOIN {{table_prefix}}job j ON j.id = i.value
)
UPDATE {{table_prefix}}job
SET scheduled_at = datetime('now', 'subsec')
WHERE id IN (SELECT input_id FROM _classified WHERE current_status = 'pending')
  AND NOT EXISTS (
    SELECT 1 FROM _classified WHERE found_id IS NULL OR current_status != 'pending'
  )
RETURNING *
`,
    {
      id: "triggerJobs",
      params: [t.string()],
      columns: { ...dbJobColumns },
    },
  );

  const getJobStatusesByIdsSql = sql(
    /* sql */ `
SELECT id, status FROM {{table_prefix}}job
WHERE id IN (SELECT value FROM json_each(?))
`,
    {
      id: "getJobStatusesByIds",
      params: [t.string()],
      columns: { id, status: t.string() },
      readOnly: true,
    },
  );

  const renewJobLeaseSql = sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET leased_by = ?,
  leased_until = datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds'),
  status = 'running'
WHERE id = ?
RETURNING *
`,
    {
      id: "renewJobLease",
      params: [t.string(), t.number(), id],
      columns: { ...dbJobColumns },
    },
  );

  const acquireJobSql = sql(
    /* sql */ `
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
  );

  const getNextJobAvailableInMsSql = sql(
    /* sql */ `
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
  );

  const reapExpiredJobLeaseSql = sql(
    /* sql */ `
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
  );

  const getConnectedChainIdsSql = sql(
    /* sql */ `
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
      columns: { chain_id: id },
      readOnly: true,
    },
  );

  const checkExternalBlockerRefsSql = sql(
    /* sql */ `
SELECT jb.job_id, jb.blocked_by_chain_id
FROM {{table_prefix}}job_blocker jb
JOIN {{table_prefix}}job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id IN (SELECT value FROM json_each(?))
  AND j.chain_id NOT IN (SELECT value FROM json_each(?))
`,
    {
      id: "checkExternalBlockerRefs",
      params: [t.string(), t.string()],
      columns: { job_id: id, blocked_by_chain_id: id },
      readOnly: true,
    },
  );

  const deleteBlockersByChainIdsSql = sql(
    /* sql */ `
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
  );

  const getChainsByChainIdsSql = sql(
    /* sql */ `
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
  );

  const deleteChainsSql = sql(
    /* sql */ `
DELETE FROM {{table_prefix}}job
WHERE chain_id IN (SELECT value FROM json_each(?))
`,
    {
      id: "deleteChains",
      params: [t.string()],
      columns: {},
    },
  );

  return {
    dbJobColumns,
    dbChainRowColumns,
    createMigrationTableSql,
    getAppliedMigrationsSql,
    recordMigrationSql,
    findExistingContinuationSql,
    findDeduplicatedJobSql,
    insertJobsSql,
    insertJobBlockersSql,
    checkBlockersStatusSql,
    updateJobToBlockedSql,
    getJobForBlockersSql,
    completeJobSql,
    findReadyJobsSql,
    scheduleBlockedJobsSql,
    getJobBlockerTraceContextsSql,
    getBlockerChainTraceContextsSql,
    getChainSql,
    getJobBlockersSql,
    getJobSql,
    getJobLockedSql,
    lockLatestChainJobSql,
    rescheduleJobSql,
    triggerJobsSql,
    getJobStatusesByIdsSql,
    renewJobLeaseSql,
    acquireJobSql,
    getNextJobAvailableInMsSql,
    reapExpiredJobLeaseSql,
    getConnectedChainIdsSql,
    checkExternalBlockerRefsSql,
    deleteBlockersByChainIdsSql,
    getChainsByChainIdsSql,
    deleteChainsSql,
  } as const;
};
