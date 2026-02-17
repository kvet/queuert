import { type Migration, type NamedParameter, type TypedSql, sql } from "@queuert/typed-sql";
import { type DeduplicationScope } from "queuert";

export const jobColumns = [
  "id",
  "type_name",
  "chain_id",
  "chain_type_name",
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

  trace_context: string | null;
};

export type DbJobChainRow = DbJob & {
  [K in keyof DbJob as `lc_${K}`]: DbJob[K] | null;
};

export const migrations: Migration[] = [
  {
    name: "20240101000000_initial_schema",
    statements: [
      {
        sql: sql(
          /* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}job (
  id                            {{id_type}} PRIMARY KEY,
  type_name                     TEXT NOT NULL,
  chain_id                      {{id_type}} REFERENCES {{table_prefix}}job(id),
  chain_type_name               TEXT NOT NULL,

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
  trace_context                 TEXT
)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}job_blocker (
  job_id                        {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  -- NOTE: requires PRAGMA foreign_keys = ON (SQLite default is OFF)
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{table_prefix}}job(id),
  "index"                       INTEGER NOT NULL,
  trace_context                 TEXT,
  PRIMARY KEY (job_id, blocked_by_chain_id)
)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_acquisition_idx
ON {{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_created_at_idx
ON {{table_prefix}}job (chain_id, created_at DESC)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND id = chain_id`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_expired_lease_idx
ON {{table_prefix}}job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`,
          false,
        ),
      },
    ],
  },
];

export type DbMigration = {
  name: string;
  applied_at: string;
};

export const createMigrationTableSql: TypedSql<[], void> = sql(
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}migration (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
)`,
  false,
);

export const getAppliedMigrationsSql: TypedSql<[], DbMigration[]> = sql(
  /* sql */ `SELECT name, applied_at FROM {{table_prefix}}migration ORDER BY name`,
  true,
);

export const recordMigrationSql: TypedSql<readonly [NamedParameter<"name", string>], void> = sql(
  /* sql */ `INSERT INTO {{table_prefix}}migration (name) VALUES (?) ON CONFLICT (name) DO NOTHING`,
  false,
);

export const findExistingJobSql: TypedSql<
  [
    NamedParameter<"chain_id_1", string | null>,
    NamedParameter<"deduplication_key_1", string | null>,
    NamedParameter<"chain_id_2", string | null>,
    NamedParameter<"deduplication_key_2", string | null>,
    NamedParameter<"deduplication_key_3", string | null>,
    NamedParameter<"deduplication_key_4", string | null>,
    NamedParameter<"chain_type_name", string>,
    NamedParameter<"deduplication_scope_1", DeduplicationScope | null>,
    NamedParameter<"deduplication_scope_2", DeduplicationScope | null>,
    NamedParameter<"deduplication_scope_3", DeduplicationScope | null>,
    NamedParameter<"deduplication_window_ms_1", number | null>,
    NamedParameter<"deduplication_window_ms_2", number | null>,
  ],
  [DbJob & { deduplicated: number }]
> = sql(
  /* sql */ `
SELECT *, 1 AS deduplicated
FROM {{table_prefix}}job
WHERE (
  (? IS NOT NULL AND ? IS NOT NULL AND chain_id = ? AND id != chain_id AND deduplication_key = ?)
  OR
  (
    ? IS NOT NULL
    AND deduplication_key = ?
    AND id = chain_id
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
  )
)
ORDER BY created_at DESC
LIMIT 1
`,
  true,
);

export const insertJobSql: TypedSql<
  readonly [
    NamedParameter<"id", string>,
    NamedParameter<"type_name", string>,
    NamedParameter<"chain_id", string | null>,
    NamedParameter<"id_for_chain", string>,
    NamedParameter<"chain_type_name", string>,
    NamedParameter<"input", string | null>,
    NamedParameter<"deduplication_key", string | null>,
    NamedParameter<"scheduled_at", string | null>,
    NamedParameter<"schedule_after_ms_check", number | null>,
    NamedParameter<"schedule_after_ms", number | null>,
    NamedParameter<"trace_context", string | null>,
  ],
  [DbJob & { deduplicated: number }]
> = sql(
  /* sql */ `
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_type_name, input, deduplication_key, scheduled_at, trace_context)
VALUES (?, ?, COALESCE(?, ?), ?, ?, ?,
  COALESCE(?,
    CASE WHEN ? IS NOT NULL THEN datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds') ELSE NULL END,
    datetime('now', 'subsec')),
  ?)
RETURNING *, 0 AS deduplicated
`,
  true,
);

export const insertJobBlockersSql: TypedSql<
  readonly [
    NamedParameter<"job_id", string>,
    NamedParameter<"trace_contexts_json", string>,
    NamedParameter<"blocked_by_chain_ids_json", string>,
  ],
  void
> = sql(
  /* sql */ `
INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT ?, je.value, je.key, json_extract(?, '$[' || je.key || ']')
FROM json_each(?) AS je
`,
  false,
);

export const checkBlockersStatusSql: TypedSql<
  readonly [NamedParameter<"job_id", string>],
  { job_id: string; blocked_by_chain_id: string; blocker_status: string }[]
> = sql(
  /* sql */ `
SELECT
  jb.job_id,
  jb.blocked_by_chain_id,
  (
    SELECT j2.status
    FROM {{table_prefix}}job j2
    WHERE j2.chain_id = jb.blocked_by_chain_id
    ORDER BY j2.created_at DESC, j2.rowid DESC
    LIMIT 1
  ) AS blocker_status
FROM {{table_prefix}}job_blocker jb
WHERE jb.job_id = ?
`,
  true,
);

export const updateJobToBlockedSql: TypedSql<
  readonly [NamedParameter<"job_id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET status = 'blocked'
WHERE id = ? AND status = 'pending'
RETURNING *
`,
  true,
);

export const getJobByIdForBlockersSql: TypedSql<
  readonly [NamedParameter<"job_id", string>],
  [DbJob]
> = sql(/* sql */ `SELECT * FROM {{table_prefix}}job WHERE id = ?`, true);

export const completeJobSql: TypedSql<
  readonly [
    NamedParameter<"completed_by", string | null>,
    NamedParameter<"output", string | null>,
    NamedParameter<"id", string>,
  ],
  [DbJob]
> = sql(
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
  true,
);

export const findReadyJobsSql: TypedSql<
  readonly [NamedParameter<"blocked_by_chain_id", string>],
  { job_id: string }[]
> = sql(
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
      ORDER BY j2.created_at DESC, j2.rowid DESC
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
  true,
);

export const scheduleBlockedJobSql: TypedSql<
  readonly [NamedParameter<"job_id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET scheduled_at = datetime('now', 'subsec'),
    status = 'pending'
WHERE id = ? AND status = 'blocked'
RETURNING *
`,
  true,
);

export const getJobBlockerTraceContextsSql: TypedSql<
  readonly [NamedParameter<"blocked_by_chain_id", string>],
  { trace_context: string | null }[]
> = sql(
  /* sql */ `
SELECT jb.trace_context
FROM {{table_prefix}}job_blocker jb
WHERE jb.blocked_by_chain_id = ?
  AND jb.trace_context IS NOT NULL
`,
  true,
);

export const getBlockerChainTraceContextsSql: TypedSql<
  readonly [NamedParameter<"blocked_by_chain_ids_json", string>],
  { blocked_by_chain_id: string; trace_context: string | null }[]
> = sql(
  /* sql */ `
SELECT j.id AS blocked_by_chain_id, j.trace_context
FROM {{table_prefix}}job j
WHERE j.id IN (SELECT value FROM json_each(?))
ORDER BY j.id
`,
  true,
);

export const getJobChainByIdSql: TypedSql<
  readonly [NamedParameter<"id_1", string>, NamedParameter<"id_2", string>],
  [DbJobChainRow | undefined]
> = sql(
  /* sql */ `
SELECT
  {{job_columns:j}},
  {{job_columns_prefixed:lc:lc_}}
FROM {{table_prefix}}job AS j
LEFT JOIN (
  SELECT *
  FROM {{table_prefix}}job
  WHERE chain_id = ?
  ORDER BY created_at DESC, rowid DESC
  LIMIT 1
) AS lc ON 1=1
WHERE j.id = ?
`,
  true,
);

export const getJobBlockersSql: TypedSql<readonly [NamedParameter<"id", string>], DbJobChainRow[]> =
  sql(
    /* sql */ `
SELECT
  {{job_columns:j}},
  {{job_columns_prefixed:lc:lc_}}
FROM {{table_prefix}}job_blocker AS b
JOIN {{table_prefix}}job AS j
  ON j.id = b.blocked_by_chain_id
LEFT JOIN {{table_prefix}}job AS lc
  ON lc.chain_id = j.id
  AND lc.rowid = (
    SELECT lj.rowid
    FROM {{table_prefix}}job lj
    WHERE lj.chain_id = j.id
    ORDER BY lj.created_at DESC, lj.rowid DESC
    LIMIT 1
  )
WHERE b.job_id = ?
ORDER BY b."index" ASC
`,
    true,
  );

export const getJobByIdSql: TypedSql<readonly [NamedParameter<"id", string>], [DbJob | undefined]> =
  sql(
    /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE id = ?
`,
    true,
  );

export const rescheduleJobSql: TypedSql<
  readonly [
    NamedParameter<"scheduled_at", string | null>,
    NamedParameter<"schedule_after_ms_check", number | null>,
    NamedParameter<"schedule_after_ms", number | null>,
    NamedParameter<"error", string>,
    NamedParameter<"id", string>,
  ],
  [DbJob]
> = sql(
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
  true,
);

export const renewJobLeaseSql: TypedSql<
  readonly [
    NamedParameter<"leased_by", string>,
    NamedParameter<"lease_duration_ms", number>,
    NamedParameter<"id", string>,
  ],
  [DbJob]
> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET leased_by = ?,
  leased_until = datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds'),
  status = 'running'
WHERE id = ?
RETURNING *
`,
  true,
);

export type DbJobWithHasMore = DbJob & { has_more: number };

export const acquireJobSql: TypedSql<
  readonly [
    NamedParameter<"type_names_json_1", string>,
    NamedParameter<"type_names_json_2", string>,
  ],
  [DbJobWithHasMore | undefined]
> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET status = 'running',
    attempt = attempt + 1
WHERE id = (
  SELECT id
  FROM {{table_prefix}}job
  WHERE type_name IN (SELECT value FROM json_each(?))
    AND status = 'pending'
    AND scheduled_at <= datetime('now', 'subsec')
  ORDER BY scheduled_at ASC
  LIMIT 1
)
RETURNING *,
  EXISTS(
    SELECT 1
    FROM {{table_prefix}}job
    WHERE type_name IN (SELECT value FROM json_each(?))
      AND status = 'pending'
      AND scheduled_at <= datetime('now', 'subsec')
    LIMIT 1
  ) AS has_more
`,
  true,
);

export const getNextJobAvailableInMsSql: TypedSql<
  readonly [NamedParameter<"type_names_json", string>],
  [{ available_in_ms: number } | undefined]
> = sql(
  /* sql */ `
SELECT
  MAX(0, CAST((julianday(job.scheduled_at) - julianday(datetime('now', 'subsec'))) * 86400000 AS INTEGER)) AS available_in_ms
FROM {{table_prefix}}job as job
WHERE job.type_name IN (SELECT value FROM json_each(?))
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
`,
  true,
);

export const removeExpiredJobLeaseSql: TypedSql<
  readonly [
    NamedParameter<"type_names_json", string>,
    NamedParameter<"ignored_job_ids_json", string>,
  ],
  [DbJob | undefined]
> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = (
  SELECT id
  FROM {{table_prefix}}job
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
  true,
);

export const checkExternalBlockerRefsSql: TypedSql<
  readonly [NamedParameter<"chain_ids_json_1", string>, NamedParameter<"chain_ids_json_2", string>],
  { job_id: string; blocked_by_chain_id: string }[]
> = sql(
  /* sql */ `
SELECT jb.job_id, jb.blocked_by_chain_id
FROM {{table_prefix}}job_blocker jb
JOIN {{table_prefix}}job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id IN (SELECT value FROM json_each(?))
  AND j.chain_id NOT IN (SELECT value FROM json_each(?))
`,
  true,
);

export const deleteBlockersByChainIdsSql: TypedSql<
  readonly [NamedParameter<"chain_ids_json", string>],
  []
> = sql(
  /* sql */ `
DELETE FROM {{table_prefix}}job_blocker
WHERE job_id IN (
  SELECT id FROM {{table_prefix}}job WHERE chain_id IN (SELECT value FROM json_each(?))
)
`,
  false,
);

export const getJobChainsByChainIdsSql: TypedSql<
  readonly [NamedParameter<"chain_ids_json", string>],
  DbJobChainRow[]
> = sql(
  /* sql */ `
SELECT
  {{job_columns:j}},
  {{job_columns_prefixed:lc:lc_}}
FROM {{table_prefix}}job AS j
LEFT JOIN {{table_prefix}}job AS lc
  ON lc.chain_id = j.id
  AND lc.rowid = (
    SELECT rowid FROM {{table_prefix}}job
    WHERE chain_id = j.id
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  )
WHERE j.id = j.chain_id
  AND j.chain_id IN (SELECT value FROM json_each(?))
`,
  true,
);

export const deleteJobsByChainIdsSql: TypedSql<
  readonly [NamedParameter<"chain_ids_json", string>],
  []
> = sql(
  /* sql */ `
DELETE FROM {{table_prefix}}job
WHERE chain_id IN (SELECT value FROM json_each(?))
`,
  false,
);

export const getJobForUpdateSql: TypedSql<
  readonly [NamedParameter<"id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE id = ?
`,
  true,
);

export const getCurrentJobForUpdateSql: TypedSql<
  readonly [NamedParameter<"chain_id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE chain_id = ?
ORDER BY created_at DESC, rowid DESC
LIMIT 1
`,
  true,
);
