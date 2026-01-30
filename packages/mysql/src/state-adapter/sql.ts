import {
  type MigrationStatement,
  type NamedParameter,
  type TypedSql,
  sql,
} from "@queuert/typed-sql";
import { type DeduplicationStrategy } from "queuert";

export const jobColumns = [
  "id",
  "type_name",
  "chain_id",
  "chain_type_name",
  "input",
  "output",
  "root_chain_id",
  "origin_id",
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
  "updated_at",
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

  root_chain_id: string;
  origin_id: string | null;

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

  updated_at: string;
};

export type DbJobChainRow = DbJob & {
  [K in keyof DbJob as `lc_${K}`]: DbJob[K] | null;
};

export const migrationStatements: MigrationStatement[] = [
  // Tables: job table
  {
    sql: sql(
      /* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}job (
  id                            {{id_type}} PRIMARY KEY,
  type_name                     VARCHAR(255) NOT NULL,
  chain_id                      {{id_type}},
  chain_type_name               VARCHAR(255) NOT NULL,

  input                         JSON,
  output                        JSON,

  -- lineage / tracing
  root_chain_id                 {{id_type}},
  origin_id                     {{id_type}},

  -- state
  status                        VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at                    DATETIME(6) NOT NULL DEFAULT NOW(6),
  scheduled_at                  DATETIME(6) NOT NULL DEFAULT NOW(6),
  completed_at                  DATETIME(6),
  completed_by                  VARCHAR(255),

  -- attempts
  attempt                       INT NOT NULL DEFAULT 0,
  last_attempt_at               DATETIME(6),
  last_attempt_error            JSON,

  -- leasing
  leased_by                     VARCHAR(255),
  leased_until                  DATETIME(6),

  -- deduplication
  deduplication_key             VARCHAR(255),

  -- metadata
  updated_at                    DATETIME(6) NOT NULL DEFAULT NOW(6) ON UPDATE NOW(6),

  -- constraints
  CONSTRAINT {{table_prefix}}job_status_chk CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  CONSTRAINT {{table_prefix}}job_chain_id_fk FOREIGN KEY (chain_id) REFERENCES {{table_prefix}}job(id) ON DELETE CASCADE,
  CONSTRAINT {{table_prefix}}job_root_chain_id_fk FOREIGN KEY (root_chain_id) REFERENCES {{table_prefix}}job(id) ON DELETE CASCADE,
  CONSTRAINT {{table_prefix}}job_origin_id_fk FOREIGN KEY (origin_id) REFERENCES {{table_prefix}}job(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      false,
    ),
  },

  // Tables: job_blocker table
  {
    sql: sql(
      /* sql */ `
CREATE TABLE IF NOT EXISTS {{table_prefix}}job_blocker (
  job_id                        {{id_type}} NOT NULL,
  blocked_by_chain_id           {{id_type}} NOT NULL,
  \`index\`                     INT NOT NULL,
  PRIMARY KEY (job_id, blocked_by_chain_id),
  CONSTRAINT {{table_prefix}}job_blocker_job_id_fk FOREIGN KEY (job_id) REFERENCES {{table_prefix}}job(id) ON DELETE CASCADE,
  CONSTRAINT {{table_prefix}}job_blocker_chain_id_fk FOREIGN KEY (blocked_by_chain_id) REFERENCES {{table_prefix}}job(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      false,
    ),
  },

  // Indexes: continuation deduplication (unique partial index simulation)
  // MySQL doesn't support partial unique indexes, so we create a regular unique index
  // Note: Migration will ignore "Duplicate key name" errors for index creation
  {
    sql: sql(
      /* sql */ `
CREATE UNIQUE INDEX {{table_prefix}}job_chain_origin_unique_idx
ON {{table_prefix}}job (chain_id, origin_id)`,
      false,
    ),
  },

  // Indexes: job acquisition
  {
    sql: sql(
      /* sql */ `
CREATE INDEX {{table_prefix}}job_acquisition_idx
ON {{table_prefix}}job (type_name, scheduled_at, status)`,
      false,
    ),
  },

  // Indexes: last chain job lookup
  {
    sql: sql(
      /* sql */ `
CREATE INDEX {{table_prefix}}job_chain_created_at_idx
ON {{table_prefix}}job (chain_id, created_at DESC)`,
      false,
    ),
  },

  // Indexes: deduplication lookup
  {
    sql: sql(
      /* sql */ `
CREATE INDEX {{table_prefix}}job_deduplication_idx
ON {{table_prefix}}job (deduplication_key, created_at DESC)`,
      false,
    ),
  },

  // Indexes: expired lease reaping
  {
    sql: sql(
      /* sql */ `
CREATE INDEX {{table_prefix}}job_expired_lease_idx
ON {{table_prefix}}job (type_name, leased_until, status)`,
      false,
    ),
  },

  // Indexes: blocker lookup
  {
    sql: sql(
      /* sql */ `
CREATE INDEX {{table_prefix}}job_blocker_chain_idx
ON {{table_prefix}}job_blocker (blocked_by_chain_id)`,
      false,
    ),
  },
];

// MySQL doesn't support RETURNING, so we split job creation into find + insert + select
export const findExistingJobSql: TypedSql<
  [
    NamedParameter<"chain_id_1", string | null>,
    NamedParameter<"origin_id_1", string | null>,
    NamedParameter<"chain_id_2", string | null>,
    NamedParameter<"origin_id_2", string | null>,
    NamedParameter<"deduplication_key_1", string | null>,
    NamedParameter<"deduplication_key_2", string | null>,
    NamedParameter<"deduplication_strategy_1", DeduplicationStrategy | null>,
    NamedParameter<"deduplication_strategy_2", DeduplicationStrategy | null>,
    NamedParameter<"deduplication_strategy_3", DeduplicationStrategy | null>,
    NamedParameter<"deduplication_window_ms_1", number | null>,
    NamedParameter<"deduplication_window_ms_2", number | null>,
  ],
  [DbJob & { deduplicated: number }]
> = sql(
  /* sql */ `
SELECT *, 1 AS deduplicated
FROM {{table_prefix}}job
WHERE (
  (? IS NOT NULL AND ? IS NOT NULL AND chain_id = ? AND origin_id = ?)
  OR
  (
    ? IS NOT NULL
    AND deduplication_key = ?
    AND id = chain_id
    AND (
      ? IS NULL
      OR (? = 'completed' AND status != 'completed')
      OR (? = 'all')
    )
    AND (
      ? IS NULL
      OR created_at >= DATE_SUB(NOW(6), INTERVAL ? * 1000 MICROSECOND)
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
    NamedParameter<"root_chain_id", string | null>,
    NamedParameter<"id_for_root", string>,
    NamedParameter<"origin_id", string | null>,
    NamedParameter<"deduplication_key", string | null>,
    NamedParameter<"scheduled_at", string | null>,
    NamedParameter<"schedule_after_ms_check", number | null>,
    NamedParameter<"schedule_after_ms", number | null>,
  ],
  void
> = sql(
  /* sql */ `
INSERT INTO {{table_prefix}}job (id, type_name, chain_id, chain_type_name, input, root_chain_id, origin_id, deduplication_key, scheduled_at)
VALUES (?, ?, COALESCE(?, ?), ?, ?, COALESCE(?, ?), ?, ?,
  COALESCE(?,
    CASE WHEN ? IS NOT NULL THEN DATE_ADD(NOW(6), INTERVAL ? * 1000 MICROSECOND) ELSE NULL END,
    NOW(6)))
`,
  false,
);

export const getJobByIdWithDedupSql: TypedSql<
  readonly [NamedParameter<"id", string>],
  [DbJob & { deduplicated: number }]
> = sql(
  /* sql */ `
SELECT *, 0 AS deduplicated
FROM {{table_prefix}}job
WHERE id = ?
`,
  true,
);

export const insertJobBlockersSql: TypedSql<
  readonly [NamedParameter<"job_id", string>, NamedParameter<"blocked_by_chain_ids_json", string>],
  void
> = sql(
  /* sql */ `
INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, \`index\`)
SELECT ?, jt.value, jt.idx
FROM JSON_TABLE(?, '$[*]' COLUMNS(
  idx FOR ORDINALITY,
  value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$'
)) AS jt
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
    ORDER BY j2.created_at DESC
    LIMIT 1
  ) AS blocker_status
FROM {{table_prefix}}job_blocker jb
WHERE jb.job_id = ?
`,
  true,
);

export const updateJobToBlockedSql: TypedSql<readonly [NamedParameter<"job_id", string>], void> =
  sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET status = 'blocked'
WHERE id = ? AND status = 'pending'
`,
    false,
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
  void
> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET status = 'completed',
  completed_at = NOW(6),
  completed_by = ?,
  output = ?,
  leased_by = NULL,
  leased_until = NULL
WHERE id = ?
`,
  false,
);

export const getCompletedJobSql: TypedSql<readonly [NamedParameter<"id", string>], [DbJob]> = sql(
  /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE id = ?
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
      ORDER BY j2.created_at DESC
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

export const scheduleBlockedJobSql: TypedSql<readonly [NamedParameter<"job_id", string>], void> =
  sql(
    /* sql */ `
UPDATE {{table_prefix}}job
SET scheduled_at = NOW(6),
    status = 'pending'
WHERE id = ? AND status = 'blocked'
`,
    false,
  );

export const getScheduledJobSql: TypedSql<
  readonly [NamedParameter<"job_id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE id = ? AND status = 'pending'
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
  ORDER BY created_at DESC
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
  AND lc.created_at = (
    SELECT MAX(lj.created_at)
    FROM {{table_prefix}}job lj
    WHERE lj.chain_id = j.id
  )
WHERE b.job_id = ?
ORDER BY b.\`index\` ASC
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
  void
> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET scheduled_at = COALESCE(?,
    CASE WHEN ? IS NOT NULL THEN DATE_ADD(NOW(6), INTERVAL ? * 1000 MICROSECOND) ELSE NULL END,
    NOW(6)),
  last_attempt_at = NOW(6),
  last_attempt_error = ?,
  leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = ?
`,
  false,
);

export const getRescheduledJobSql: TypedSql<readonly [NamedParameter<"id", string>], [DbJob]> = sql(
  /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE id = ?
`,
  true,
);

export const renewJobLeaseSql: TypedSql<
  readonly [
    NamedParameter<"leased_by", string>,
    NamedParameter<"lease_duration_ms", number>,
    NamedParameter<"id", string>,
  ],
  void
> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET leased_by = ?,
  leased_until = DATE_ADD(NOW(6), INTERVAL ? * 1000 MICROSECOND),
  status = 'running'
WHERE id = ?
`,
  false,
);

export const getRenewedJobSql: TypedSql<readonly [NamedParameter<"id", string>], [DbJob]> = sql(
  /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE id = ?
`,
  true,
);

export type DbJobWithHasMore = DbJob & { has_more: number };

// For MySQL, we need to:
// 1. SELECT the job to acquire with FOR UPDATE SKIP LOCKED
// 2. UPDATE that job
// 3. SELECT the updated job with has_more flag
export const selectJobToAcquireSql: TypedSql<
  readonly [NamedParameter<"type_names_json", string>],
  [{ id: string } | undefined]
> = sql(
  /* sql */ `
SELECT id
FROM {{table_prefix}}job
WHERE type_name IN (SELECT jt.value FROM JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$')) AS jt)
  AND status = 'pending'
  AND scheduled_at <= NOW(6)
ORDER BY scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
`,
  true,
);

export const updateAcquiredJobSql: TypedSql<readonly [NamedParameter<"id", string>], void> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET status = 'running',
    attempt = attempt + 1
WHERE id = ?
`,
  false,
);

export const getAcquiredJobWithHasMoreSql: TypedSql<
  readonly [NamedParameter<"type_names_json", string>, NamedParameter<"id", string>],
  [DbJobWithHasMore]
> = sql(
  /* sql */ `
SELECT *,
  EXISTS(
    SELECT 1
    FROM {{table_prefix}}job
    WHERE type_name IN (SELECT jt.value FROM JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$')) AS jt)
      AND status = 'pending'
      AND scheduled_at <= NOW(6)
    LIMIT 1
  ) AS has_more
FROM {{table_prefix}}job
WHERE id = ?
`,
  true,
);

export const getNextJobAvailableInMsSql: TypedSql<
  readonly [NamedParameter<"type_names_json", string>],
  [{ available_in_ms: number } | undefined]
> = sql(
  /* sql */ `
SELECT
  GREATEST(0, CAST(TIMESTAMPDIFF(MICROSECOND, NOW(6), job.scheduled_at) / 1000 AS SIGNED)) AS available_in_ms
FROM {{table_prefix}}job AS job
WHERE job.type_name IN (SELECT jt.value FROM JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$')) AS jt)
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
`,
  true,
);

// For removing expired lease, we also need multi-step approach
export const selectExpiredLeaseSql: TypedSql<
  readonly [NamedParameter<"type_names_json", string>],
  [{ id: string } | undefined]
> = sql(
  /* sql */ `
SELECT id
FROM {{table_prefix}}job
WHERE leased_until IS NOT NULL
  AND leased_until < NOW(6)
  AND status = 'running'
  AND type_name IN (SELECT jt.value FROM JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$')) AS jt)
ORDER BY leased_until ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
`,
  true,
);

export const updateExpiredLeaseSql: TypedSql<readonly [NamedParameter<"id", string>], void> = sql(
  /* sql */ `
UPDATE {{table_prefix}}job
SET leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = ?
`,
  false,
);

export const getUpdatedExpiredLeaseSql: TypedSql<
  readonly [NamedParameter<"id", string>],
  [DbJob]
> = sql(
  /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE id = ?
`,
  true,
);

export const getExternalBlockersSql: TypedSql<
  readonly [
    NamedParameter<"root_chain_ids_json_1", string>,
    NamedParameter<"root_chain_ids_json_2", string>,
  ],
  { job_id: string; blocked_root_chain_id: string }[]
> = sql(
  /* sql */ `
SELECT DISTINCT jb.job_id, j.root_chain_id AS blocked_root_chain_id
FROM {{table_prefix}}job_blocker jb
JOIN {{table_prefix}}job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id IN (
  SELECT id FROM {{table_prefix}}job WHERE root_chain_id IN (SELECT jt.value FROM JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$')) AS jt)
)
AND j.root_chain_id NOT IN (SELECT jt.value FROM JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$')) AS jt)
`,
  true,
);

// For delete, we need to SELECT first, then DELETE
export const selectJobsToDeleteSql: TypedSql<
  readonly [NamedParameter<"root_chain_ids_json", string>],
  DbJob[]
> = sql(
  /* sql */ `
SELECT *
FROM {{table_prefix}}job
WHERE root_chain_id IN (SELECT jt.value FROM JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$')) AS jt)
`,
  true,
);

export const deleteJobsByRootChainIdsSql: TypedSql<
  readonly [NamedParameter<"root_chain_ids_json", string>],
  void
> = sql(
  /* sql */ `
DELETE FROM {{table_prefix}}job
WHERE root_chain_id IN (SELECT jt.value FROM JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$')) AS jt)
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
FOR UPDATE
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
ORDER BY created_at DESC
LIMIT 1
FOR UPDATE
`,
  true,
);
