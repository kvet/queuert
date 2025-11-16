import { NamedParameter, TypedSql } from "./sql-executor.js";

// TODO: pgstattuple with partitioning
export const setupSql = /* sql */ `
CREATE SCHEMA IF NOT EXISTS queuert;
GRANT USAGE ON SCHEMA queuert TO test;
` as TypedSql<readonly [], void>;

export const migrateSql = /* sql */ `
-- Types: job_status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status' AND typnamespace = 'queuert'::regnamespace) THEN
    CREATE TYPE queuert.job_status AS ENUM ('created','waiting','pending','running','completed');
  END IF;
END$$;

-- Tables: job table
CREATE TABLE IF NOT EXISTS queuert.job (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name                    text NOT NULL,

  input                         jsonb,
  output                        jsonb,

  -- lineage / tracing
  root_id                       uuid REFERENCES queuert.job(id) ON DELETE CASCADE, -- TODO: NOT NULL
  chain_id                      uuid REFERENCES queuert.job(id) ON DELETE CASCADE, -- TODO: NOT NULL
  parent_id                     uuid REFERENCES queuert.job(id) ON DELETE CASCADE,

  -- state
  status                        queuert.job_status NOT NULL DEFAULT 'created',
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,

  -- attempts
  attempt                       integer NOT NULL DEFAULT 0,
  last_attempt_at               timestamptz,
  last_attempt_error            text,

  -- locking/heartbeats
  locked_by                     text,
  locked_until                  timestamptz
);

-- Tables: job_dependency table
CREATE TABLE IF NOT EXISTS queuert.job_dependency (
  job_id                        uuid NOT NULL REFERENCES queuert.job(id) ON DELETE CASCADE,
  depends_on_chain_id           uuid NOT NULL REFERENCES queuert.job(id) ON DELETE CASCADE,
  index                         integer NOT NULL,
  PRIMARY KEY (job_id, depends_on_chain_id)
);
` as TypedSql<[], void>;

export type DbJobId = string;
export type DbJob = {
  id: DbJobId;
  queue_name: string;
  input: unknown;
  output: unknown;

  root_id: DbJobId;
  chain_id: DbJobId;
  parent_id: DbJobId;

  status: "created" | "waiting" | "pending" | "running" | "completed";
  created_at: string;
  scheduled_at: string;
  completed_at: string | null;

  attempt: number;
  last_attempt_error: unknown; // TODO: remove?
  last_attempt_at: string | null;

  locked_by: string | null;
  locked_until: string | null;

  updated_at: string;
};

export const createJobSql = /* sql */ `
WITH new_id AS (SELECT gen_random_uuid() AS id)
INSERT INTO queuert.job (id, queue_name, input, chain_id)
SELECT id, $1, $2, id
FROM new_id
ON CONFLICT (id) DO NOTHING
RETURNING *
` as TypedSql<
  readonly [
    NamedParameter<"queue_name", string>,
    NamedParameter<"input", unknown>
  ],
  [DbJob]
>;

export const addJobDependenciesSql = /* sql */ `
INSERT INTO queuert.job_dependency (job_id, depends_on_chain_id, "index")
SELECT job_id, depends_on_chain_id, ord - 1 AS "index"
FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS t(job_id, depends_on_chain_id, ord)
` as TypedSql<
  readonly [
    NamedParameter<"job_id", string[]>,
    NamedParameter<"depends_on_chain_id", string[]>
  ],
  DbJob[]
>;

export const markJobAsWaitingSql = /* sql */ `
UPDATE queuert.job
SET status = 'waiting'
WHERE id = $1
RETURNING *
` as TypedSql<readonly [NamedParameter<"id", string>], [DbJob]>;

export const markJobAsPendingSql = /* sql */ `
UPDATE queuert.job
SET status = 'pending'
WHERE id = $1
RETURNING *
` as TypedSql<readonly [NamedParameter<"id", string>], [DbJob]>;

export const markJobAsRunningSql = /* sql */ `
UPDATE queuert.job
SET status = 'running'
WHERE id = $1
RETURNING *
` as TypedSql<readonly [NamedParameter<"id", string>], [DbJob]>;

export const completeJobSql = /* sql */ `
UPDATE queuert.job
SET status = 'completed',
  completed_at = now(),
  output = $2,
  locked_by = NULL,
  locked_until = NULL
WHERE id = $1
RETURNING *
` as TypedSql<
  readonly [NamedParameter<"id", string>, NamedParameter<"output", unknown>],
  [DbJob]
>;

export const linkJobSql = /* sql */ `
UPDATE queuert.job
SET chain_id = $2
WHERE id = $1
RETURNING *
` as TypedSql<
  readonly [NamedParameter<"id", string>, NamedParameter<"chain_id", string>],
  [DbJob]
>;

export const scheduleDependentJobsSql = /* sql */ `
WITH direct_dependents AS (
  SELECT DISTINCT jd.job_id
  FROM queuert.job_dependency jd
  WHERE jd.depends_on_chain_id = $1
),
deps_status AS (
  SELECT
    jd.job_id,
    jd.depends_on_chain_id,
    (
      SELECT j2.status
      FROM queuert.job j2
      WHERE j2.chain_id = jd.depends_on_chain_id
      ORDER BY j2.created_at DESC
      LIMIT 1
    ) AS dep_status
  FROM queuert.job_dependency jd
  WHERE jd.job_id IN (SELECT job_id FROM direct_dependents)
),
ready_jobs AS (
  SELECT job_id
  FROM deps_status
  GROUP BY job_id
  HAVING bool_and(dep_status = 'completed')
)
UPDATE queuert.job j
SET scheduled_at = now(),
  status = 'pending'
WHERE j.id IN (SELECT job_id FROM ready_jobs)
  AND j.status = 'waiting'
RETURNING j.id;
` as TypedSql<
  readonly [NamedParameter<"depends_on_chain_id", string>],
  DbJobId[]
>;

export const getJobChainById = /* sql */ `
SELECT j.*,
       COALESCE(l.status,      j.status)      AS status,
       COALESCE(l.output,      j.output)      AS output,
       COALESCE(l.completed_at, j.completed_at) AS completed_at
FROM queuert.job AS j
LEFT JOIN LATERAL (
  SELECT status, output, completed_at
  FROM queuert.job
  WHERE chain_id = j.id
  ORDER BY created_at DESC
  LIMIT 1
) AS l ON TRUE
WHERE j.id = $1
` as TypedSql<readonly [NamedParameter<"id", string>], [DbJob]>;

export const getJobDependenciesSql = /* sql */ `
SELECT j.*,
       COALESCE(l.status,      j.status)      AS status,
       COALESCE(l.output,      j.output)      AS output,
       COALESCE(l.completed_at, j.completed_at) AS completed_at
FROM queuert.job_dependency AS d
JOIN queuert.job AS j
  ON j.id = d.depends_on_chain_id
LEFT JOIN LATERAL (
  SELECT status, output, completed_at
  FROM queuert.job
  WHERE chain_id = j.id
  ORDER BY created_at DESC
  LIMIT 1
) AS l ON TRUE
WHERE d.job_id = $1
ORDER BY d.index ASC
` as TypedSql<readonly [NamedParameter<"id", string>], DbJob[]>;

export const getJobByIdSql = /* sql */ `
SELECT *
FROM queuert.job
WHERE id = $1
` as TypedSql<readonly [NamedParameter<"id", string>], [DbJob]>;

export const rescheduleJobSql = /* sql */ `
UPDATE queuert.job
SET scheduled_at = now() + ($2::text || ' milliseconds')::interval,
  attempt = attempt + 1,
  last_attempt_at = now(),
  last_attempt_error = $3,
  locked_by = NULL,
  locked_until = NULL,
  status = 'pending'
WHERE id = $1
RETURNING *
` as TypedSql<
  readonly [
    NamedParameter<"id", string>,
    NamedParameter<"delay_ms", number>,
    NamedParameter<"error", string>
  ],
  [DbJob]
>;

export const heartbeatJobSql = /* sql */ `
UPDATE queuert.job
SET locked_by = $2,
  locked_until = now() + ($3::text || ' milliseconds')::interval,
  status = 'running'
WHERE id = $1
RETURNING *
` as TypedSql<
  readonly [
    NamedParameter<"id", string>,
    NamedParameter<"locked_by", string>,
    NamedParameter<"lock_duration_ms", number>
  ],
  [DbJob]
>;

export const getJobsToProcessSql = /* sql */ `
SELECT job.*
FROM queuert.job as job
WHERE job.queue_name IN (SELECT unnest($1::text[]))
  AND job.status IN ('created', 'pending')
  AND job.scheduled_at <= now()
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
` as TypedSql<
  readonly [NamedParameter<"queue_names", string[]>],
  [DbJob | undefined]
>;

export const getNextJobAvailableAt = /* sql */ `
SELECT job.scheduled_at, now() AS current_time
FROM queuert.job as job
WHERE job.queue_name IN (SELECT unnest($1::text[]))
  AND job.status IN ('created', 'pending')
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
` as TypedSql<
  readonly [NamedParameter<"queue_names", string[]>],
  [{ scheduled_at: Date; current_time: Date } | undefined]
>;
