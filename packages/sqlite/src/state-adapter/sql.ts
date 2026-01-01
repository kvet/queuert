import { type DeduplicationStrategy } from "@queuert/core";
import { type NamedParameter, sql, type TypedSql } from "@queuert/typed-sql";

export const migrateSql: TypedSql<[], void> = sql(
  /* sql */ `
-- Tables: job table
CREATE TABLE IF NOT EXISTS queuert_job (
  id                            TEXT PRIMARY KEY,
  type_name                     TEXT NOT NULL,

  input                         TEXT,
  output                        TEXT,

  -- lineage / tracing
  root_id                       TEXT REFERENCES queuert_job(id) ON DELETE CASCADE,
  sequence_id                   TEXT REFERENCES queuert_job(id) ON DELETE CASCADE,
  origin_id                     TEXT REFERENCES queuert_job(id) ON DELETE CASCADE,

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

  -- metadata
  updated_at                    TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);

-- Tables: job_blocker table
CREATE TABLE IF NOT EXISTS queuert_job_blocker (
  job_id                        TEXT NOT NULL REFERENCES queuert_job(id) ON DELETE CASCADE,
  blocked_by_sequence_id        TEXT NOT NULL REFERENCES queuert_job(id) ON DELETE CASCADE,
  "index"                       INTEGER NOT NULL,
  PRIMARY KEY (job_id, blocked_by_sequence_id)
);

-- Constraints: continuation deduplication
CREATE UNIQUE INDEX IF NOT EXISTS job_sequence_origin_unique_idx
ON queuert_job (sequence_id, origin_id)
WHERE origin_id IS NOT NULL;

-- Indexes: job acquisition
CREATE INDEX IF NOT EXISTS job_acquisition_idx
ON queuert_job (type_name, scheduled_at)
WHERE status = 'pending';

-- Indexes: last sequence job lookup
CREATE INDEX IF NOT EXISTS job_sequence_created_at_idx
ON queuert_job (sequence_id, created_at DESC);

-- Indexes: deduplication lookup
CREATE INDEX IF NOT EXISTS job_deduplication_idx
ON queuert_job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL;

-- Indexes: expired lease reaping
CREATE INDEX IF NOT EXISTS job_expired_lease_idx
ON queuert_job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL;

-- Indexes: blocker lookup
CREATE INDEX IF NOT EXISTS job_blocker_sequence_idx
ON queuert_job_blocker (blocked_by_sequence_id);

-- Triggers: updated_at trigger
CREATE TRIGGER IF NOT EXISTS update_job_updated_at
AFTER UPDATE ON queuert_job
FOR EACH ROW
BEGIN
  UPDATE queuert_job SET updated_at = datetime('now', 'subsec') WHERE id = NEW.id;
END;
`,
  false,
);

export type DbJob = {
  id: string;
  type_name: string;
  input: string | null;
  output: string | null;

  root_id: string;
  sequence_id: string;
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

export const findExistingJobSql: TypedSql<
  [
    NamedParameter<"sequence_id_1", string | null>,
    NamedParameter<"origin_id_1", string | null>,
    NamedParameter<"sequence_id_2", string | null>,
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
FROM queuert_job
WHERE (
  (? IS NOT NULL AND ? IS NOT NULL AND sequence_id = ? AND origin_id = ?)
  OR
  (
    ? IS NOT NULL
    AND deduplication_key = ?
    AND id = sequence_id
    AND (
      ? IS NULL
      OR (? = 'completed' AND status != 'completed')
      OR (? = 'all')
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

type InsertJobParams = readonly [
  NamedParameter<"id", string>,
  NamedParameter<"type_name", string>,
  NamedParameter<"input", string | null>,
  NamedParameter<"root_id", string | null>,
  NamedParameter<"id_for_root", string>,
  NamedParameter<"sequence_id", string | null>,
  NamedParameter<"id_for_sequence", string>,
  NamedParameter<"origin_id", string | null>,
  NamedParameter<"deduplication_key", string | null>,
];

// Parameters: id, type_name, input, root_id, id_for_root, sequence_id, id_for_sequence, origin_id, deduplication_key
export const insertJobSql: TypedSql<InsertJobParams, [DbJob & { deduplicated: number }]> = sql(
  /* sql */ `
INSERT INTO queuert_job (id, type_name, input, root_id, sequence_id, origin_id, deduplication_key)
VALUES (?, ?, ?, COALESCE(?, ?), COALESCE(?, ?), ?, ?)
RETURNING *, 0 AS deduplicated
`,
  true,
);

type InsertJobBlockerParams = readonly [
  NamedParameter<"job_id", string>,
  NamedParameter<"blocked_by_sequence_id", string>,
  NamedParameter<"index", number>,
];

// SQLite doesn't support INSERT/UPDATE inside CTEs, so we split into separate queries
export const insertJobBlockerSql: TypedSql<InsertJobBlockerParams, void> = sql(
  /* sql */ `
INSERT INTO queuert_job_blocker (job_id, blocked_by_sequence_id, "index")
VALUES (?, ?, ?)
`,
  false,
);

export const checkBlockersStatusSql: TypedSql<
  readonly [NamedParameter<"job_id", string>],
  { job_id: string; blocker_status: string }[]
> = sql(
  /* sql */ `
SELECT
  jb.job_id,
  (
    SELECT j2.status
    FROM queuert_job j2
    WHERE j2.sequence_id = jb.blocked_by_sequence_id
    ORDER BY j2.created_at DESC, j2.rowid DESC
    LIMIT 1
  ) AS blocker_status
FROM queuert_job_blocker jb
WHERE jb.job_id = ?
`,
  true,
);

export const updateJobToBlockedSql: TypedSql<
  readonly [NamedParameter<"job_id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
UPDATE queuert_job
SET status = 'blocked'
WHERE id = ? AND status = 'pending'
RETURNING *
`,
  true,
);

export const getJobByIdForBlockersSql: TypedSql<
  readonly [NamedParameter<"job_id", string>],
  [DbJob]
> = sql(/* sql */ `SELECT * FROM queuert_job WHERE id = ?`, true);

export const completeJobSql: TypedSql<
  readonly [
    NamedParameter<"completed_by", string | null>,
    NamedParameter<"output", string | null>,
    NamedParameter<"id", string>,
  ],
  [DbJob]
> = sql(
  /* sql */ `
UPDATE queuert_job
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

// Find jobs that are ready to be unblocked (all their blockers are completed)
export const findReadyJobsSql: TypedSql<
  readonly [NamedParameter<"blocked_by_sequence_id", string>],
  { job_id: string }[]
> = sql(
  /* sql */ `
WITH direct_blocked AS (
  SELECT DISTINCT jb.job_id
  FROM queuert_job_blocker jb
  WHERE jb.blocked_by_sequence_id = ?
),
blockers_status AS (
  SELECT
    jb.job_id,
    jb.blocked_by_sequence_id,
    (
      SELECT j2.status
      FROM queuert_job j2
      WHERE j2.sequence_id = jb.blocked_by_sequence_id
      ORDER BY j2.created_at DESC, j2.rowid DESC
      LIMIT 1
    ) AS blocker_status
  FROM queuert_job_blocker jb
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
UPDATE queuert_job
SET scheduled_at = datetime('now', 'subsec'),
    status = 'pending'
WHERE id = ? AND status = 'blocked'
RETURNING *
`,
  true,
);

export type DbJobSequenceRow = {
  root_job: string;
  last_sequence_job: string | null;
};

// Anonymous ? params: jobId (for sequence_id), jobId (for j.id)
export const getJobSequenceByIdSql: TypedSql<
  readonly [NamedParameter<"id_1", string>, NamedParameter<"id_2", string>],
  [DbJobSequenceRow | undefined]
> = sql(
  /* sql */ `
SELECT
  json_object(
    'id', j.id,
    'type_name', j.type_name,
    'input', j.input,
    'output', j.output,
    'root_id', j.root_id,
    'sequence_id', j.sequence_id,
    'origin_id', j.origin_id,
    'status', j.status,
    'created_at', j.created_at,
    'scheduled_at', j.scheduled_at,
    'completed_at', j.completed_at,
    'completed_by', j.completed_by,
    'attempt', j.attempt,
    'last_attempt_at', j.last_attempt_at,
    'last_attempt_error', j.last_attempt_error,
    'leased_by', j.leased_by,
    'leased_until', j.leased_until,
    'deduplication_key', j.deduplication_key,
    'updated_at', j.updated_at
  ) AS root_job,
  CASE WHEN lc.id IS NOT NULL THEN
    json_object(
      'id', lc.id,
      'type_name', lc.type_name,
      'input', lc.input,
      'output', lc.output,
      'root_id', lc.root_id,
      'sequence_id', lc.sequence_id,
      'origin_id', lc.origin_id,
      'status', lc.status,
      'created_at', lc.created_at,
      'scheduled_at', lc.scheduled_at,
      'completed_at', lc.completed_at,
      'completed_by', lc.completed_by,
      'attempt', lc.attempt,
      'last_attempt_at', lc.last_attempt_at,
      'last_attempt_error', lc.last_attempt_error,
      'leased_by', lc.leased_by,
      'leased_until', lc.leased_until,
      'deduplication_key', lc.deduplication_key,
      'updated_at', lc.updated_at
    )
  ELSE NULL END AS last_sequence_job
FROM queuert_job AS j
LEFT JOIN (
  SELECT *
  FROM queuert_job
  WHERE sequence_id = ?
  ORDER BY created_at DESC, rowid DESC
  LIMIT 1
) AS lc ON 1=1
WHERE j.id = ?
`,
  true,
);

// Anonymous ? params: jobId (for b.job_id)
// Uses correlated subquery to get last job per blocker sequence (SQLite doesn't support LATERAL)
export const getJobBlockersSql: TypedSql<
  readonly [NamedParameter<"id", string>],
  DbJobSequenceRow[]
> = sql(
  /* sql */ `
SELECT
  json_object(
    'id', j.id,
    'type_name', j.type_name,
    'input', j.input,
    'output', j.output,
    'root_id', j.root_id,
    'sequence_id', j.sequence_id,
    'origin_id', j.origin_id,
    'status', j.status,
    'created_at', j.created_at,
    'scheduled_at', j.scheduled_at,
    'completed_at', j.completed_at,
    'completed_by', j.completed_by,
    'attempt', j.attempt,
    'last_attempt_at', j.last_attempt_at,
    'last_attempt_error', j.last_attempt_error,
    'leased_by', j.leased_by,
    'leased_until', j.leased_until,
    'deduplication_key', j.deduplication_key,
    'updated_at', j.updated_at
  ) AS root_job,
  CASE WHEN lc.id IS NOT NULL THEN
    json_object(
      'id', lc.id,
      'type_name', lc.type_name,
      'input', lc.input,
      'output', lc.output,
      'root_id', lc.root_id,
      'sequence_id', lc.sequence_id,
      'origin_id', lc.origin_id,
      'status', lc.status,
      'created_at', lc.created_at,
      'scheduled_at', lc.scheduled_at,
      'completed_at', lc.completed_at,
      'completed_by', lc.completed_by,
      'attempt', lc.attempt,
      'last_attempt_at', lc.last_attempt_at,
      'last_attempt_error', lc.last_attempt_error,
      'leased_by', lc.leased_by,
      'leased_until', lc.leased_until,
      'deduplication_key', lc.deduplication_key,
      'updated_at', lc.updated_at
    )
  ELSE NULL END AS last_sequence_job
FROM queuert_job_blocker AS b
JOIN queuert_job AS j
  ON j.id = b.blocked_by_sequence_id
LEFT JOIN queuert_job AS lc
  ON lc.sequence_id = j.id
  AND lc.rowid = (
    SELECT lj.rowid
    FROM queuert_job lj
    WHERE lj.sequence_id = j.id
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
FROM queuert_job
WHERE id = ?
`,
    true,
  );

// Anonymous ? params: delay_ms, error, id
export const rescheduleJobSql: TypedSql<
  readonly [
    NamedParameter<"delay_ms", number>,
    NamedParameter<"error", string>,
    NamedParameter<"id", string>,
  ],
  [DbJob]
> = sql(
  /* sql */ `
UPDATE queuert_job
SET scheduled_at = datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds'),
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

// Anonymous ? params: leased_by, lease_duration_ms, id
export const renewJobLeaseSql: TypedSql<
  readonly [
    NamedParameter<"leased_by", string>,
    NamedParameter<"lease_duration_ms", number>,
    NamedParameter<"id", string>,
  ],
  [DbJob]
> = sql(
  /* sql */ `
UPDATE queuert_job
SET leased_by = ?,
  leased_until = datetime('now', 'subsec', '+' || (? / 1000.0) || ' seconds'),
  status = 'running'
WHERE id = ?
RETURNING *
`,
  true,
);

export const acquireJobSql: TypedSql<
  readonly [NamedParameter<"type_names_json", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
UPDATE queuert_job
SET status = 'running',
    attempt = attempt + 1
WHERE id = (
  SELECT id
  FROM queuert_job
  WHERE type_name IN (SELECT value FROM json_each(?))
    AND status = 'pending'
    AND scheduled_at <= datetime('now', 'subsec')
  ORDER BY scheduled_at ASC
  LIMIT 1
)
RETURNING *
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
FROM queuert_job as job
WHERE job.type_name IN (SELECT value FROM json_each(?))
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
`,
  true,
);

export const removeExpiredJobLeaseSql: TypedSql<
  readonly [NamedParameter<"type_names_json", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
UPDATE queuert_job
SET leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = (
  SELECT id
  FROM queuert_job
  WHERE leased_until IS NOT NULL
    AND leased_until < datetime('now', 'subsec')
    AND status = 'running'
    AND type_name IN (SELECT value FROM json_each(?))
  ORDER BY leased_until ASC
  LIMIT 1
)
RETURNING *
`,
  true,
);

// Anonymous ? params: rootIdsJson (for first json_each), rootIdsJson (for second json_each)
export const getExternalBlockersSql: TypedSql<
  readonly [NamedParameter<"root_ids_json_1", string>, NamedParameter<"root_ids_json_2", string>],
  { job_id: string; blocked_root_id: string }[]
> = sql(
  /* sql */ `
SELECT DISTINCT jb.job_id, j.root_id AS blocked_root_id
FROM queuert_job_blocker jb
JOIN queuert_job j ON j.id = jb.job_id
WHERE jb.blocked_by_sequence_id IN (
  SELECT id FROM queuert_job WHERE root_id IN (SELECT value FROM json_each(?))
)
AND j.root_id NOT IN (SELECT value FROM json_each(?))
`,
  true,
);

export const deleteJobsByRootIdsSql: TypedSql<
  readonly [NamedParameter<"root_ids_json", string>],
  DbJob[]
> = sql(
  /* sql */ `
DELETE FROM queuert_job
WHERE root_id IN (SELECT value FROM json_each(?))
RETURNING *
`,
  true,
);

export const getJobForUpdateSql: TypedSql<
  readonly [NamedParameter<"id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
SELECT *
FROM queuert_job
WHERE id = ?
`,
  true,
);

export const getCurrentJobForUpdateSql: TypedSql<
  readonly [NamedParameter<"sequence_id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
SELECT *
FROM queuert_job
WHERE sequence_id = ?
ORDER BY created_at DESC, rowid DESC
LIMIT 1
`,
  true,
);
