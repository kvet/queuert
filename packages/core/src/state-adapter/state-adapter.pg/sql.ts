import { NamedParameter, TypedSql } from "./typed-sql.js";

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
  origin_id                     uuid REFERENCES queuert.job(id) ON DELETE CASCADE,

  -- state
  status                        queuert.job_status NOT NULL DEFAULT 'created',
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,

  -- attempts
  attempt                       integer NOT NULL DEFAULT 0,
  last_attempt_at               timestamptz,
  last_attempt_error            jsonb,

  -- leasing
  leased_by                     text,
  leased_until                  timestamptz,

  -- metadata
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- Tables: job_blocker table
CREATE TABLE IF NOT EXISTS queuert.job_blocker (
  job_id                        uuid NOT NULL REFERENCES queuert.job(id) ON DELETE CASCADE,
  blocked_by_chain_id           uuid NOT NULL REFERENCES queuert.job(id) ON DELETE CASCADE,
  index                         integer NOT NULL,
  PRIMARY KEY (job_id, blocked_by_chain_id)
);

-- Triggers: updated_at triggers
CREATE OR REPLACE FUNCTION queuert.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_job_updated_at ON queuert.job;
CREATE TRIGGER update_job_updated_at
BEFORE UPDATE ON queuert.job
FOR EACH ROW
EXECUTE PROCEDURE queuert.update_updated_at_column();
` as TypedSql<[], void>;

export type DbJob = {
  id: string;
  queue_name: string;
  input: unknown;
  output: unknown;

  root_id: string;
  chain_id: string;
  origin_id: string | null;

  status: "created" | "waiting" | "pending" | "running" | "completed";
  created_at: string;
  scheduled_at: string;
  completed_at: string | null;

  attempt: number;
  last_attempt_error: string | null;
  last_attempt_at: string | null;

  leased_by: string | null;
  leased_until: string | null;

  updated_at: string;
};

export const createJobSql = /* sql */ `
WITH new_id AS (SELECT gen_random_uuid() AS id)
INSERT INTO queuert.job (id, queue_name, input, root_id, chain_id, origin_id)
SELECT id, $1, $2, COALESCE($3, id), COALESCE($4, id), $5
FROM new_id
ON CONFLICT (id) DO NOTHING
RETURNING *
` as TypedSql<
  readonly [
    NamedParameter<"queue_name", string>,
    NamedParameter<"input", unknown>,
    NamedParameter<"root_id", string | undefined>,
    NamedParameter<"chain_id", string | undefined>,
    NamedParameter<"origin_id", string | undefined>,
  ],
  [DbJob]
>;

export const addJobBlockersSql = /* sql */ `
INSERT INTO queuert.job_blocker (job_id, blocked_by_chain_id, "index")
SELECT job_id, blocked_by_chain_id, ord - 1 AS "index"
FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS t(job_id, blocked_by_chain_id, ord)
` as TypedSql<
  readonly [NamedParameter<"job_id", string[]>, NamedParameter<"blocked_by_chain_id", string[]>],
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

export const startJobAttemptSql = /* sql */ `
UPDATE queuert.job
SET status = 'running',
    attempt = attempt + 1
WHERE id = $1
RETURNING *
` as TypedSql<readonly [NamedParameter<"id", string>], [DbJob]>;

export const completeJobSql = /* sql */ `
UPDATE queuert.job
SET status = 'completed',
  completed_at = now(),
  output = $2,
  leased_by = NULL,
  leased_until = NULL
WHERE id = $1
RETURNING *
` as TypedSql<readonly [NamedParameter<"id", string>, NamedParameter<"output", unknown>], [DbJob]>;

export const scheduleBlockedJobsSql = /* sql */ `
WITH direct_blocked AS (
  SELECT DISTINCT jb.job_id
  FROM queuert.job_blocker jb
  WHERE jb.blocked_by_chain_id = $1
),
blockers_status AS (
  SELECT
    jb.job_id,
    jb.blocked_by_chain_id,
    (
      SELECT j2.status
      FROM queuert.job j2
      WHERE j2.chain_id = jb.blocked_by_chain_id
      ORDER BY j2.created_at DESC
      LIMIT 1
    ) AS blocker_status
  FROM queuert.job_blocker jb
  WHERE jb.job_id IN (SELECT job_id FROM direct_blocked)
),
ready_jobs AS (
  SELECT job_id
  FROM blockers_status
  GROUP BY job_id
  HAVING bool_and(blocker_status = 'completed')
)
UPDATE queuert.job j
SET scheduled_at = now(),
  status = 'pending'
WHERE j.id IN (SELECT job_id FROM ready_jobs)
  AND j.status = 'waiting'
RETURNING j.*;
` as TypedSql<readonly [NamedParameter<"blocked_by_chain_id", string>], DbJob[]>;

export const getJobChainByIdSql = /* sql */ `
SELECT
  row_to_json(j)  AS root_job,
  row_to_json(lc) AS last_chain_job
FROM queuert.job AS j
LEFT JOIN LATERAL (
  SELECT *
  FROM queuert.job
  WHERE chain_id = j.id
  ORDER BY created_at DESC
  LIMIT 1
) AS lc ON TRUE
WHERE j.id = $1
` as TypedSql<
  readonly [NamedParameter<"id", string>],
  [{ root_job: DbJob; last_chain_job: DbJob | null } | undefined]
>;

export const getJobBlockersSql = /* sql */ `
SELECT
  row_to_json(j)   AS root_job,
  row_to_json(lc)  AS last_chain_job
FROM queuert.job_blocker AS b
JOIN queuert.job AS j
  ON j.id = b.blocked_by_chain_id
LEFT JOIN LATERAL (
  SELECT *
  FROM queuert.job
  WHERE chain_id = j.id
  ORDER BY created_at DESC
  LIMIT 1
) AS lc ON TRUE
WHERE b.job_id = $1
ORDER BY b.index ASC
` as TypedSql<
  readonly [NamedParameter<"id", string>],
  { root_job: DbJob; last_chain_job: DbJob | null }[]
>;

export const getJobByIdSql = /* sql */ `
SELECT *
FROM queuert.job
WHERE id = $1
` as TypedSql<readonly [NamedParameter<"id", string>], [DbJob | undefined]>;

export const rescheduleJobSql = /* sql */ `
UPDATE queuert.job
SET scheduled_at = now() + ($2::text || ' milliseconds')::interval,
  last_attempt_at = now(),
  last_attempt_error = $3,
  leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = $1
RETURNING *
` as TypedSql<
  readonly [
    NamedParameter<"id", string>,
    NamedParameter<"delay_ms", number>,
    NamedParameter<"error", string>,
  ],
  [DbJob]
>;

export const renewJobLeaseSql = /* sql */ `
UPDATE queuert.job
SET leased_by = $2,
  leased_until = now() + ($3::text || ' milliseconds')::interval,
  status = 'running'
WHERE id = $1
RETURNING *
` as TypedSql<
  readonly [
    NamedParameter<"id", string>,
    NamedParameter<"leased_by", string>,
    NamedParameter<"lease_duration_ms", number>,
  ],
  [DbJob]
>;

export const acquireJobSql = /* sql */ `
SELECT job.*
FROM queuert.job as job
WHERE job.queue_name IN (SELECT unnest($1::text[]))
  AND job.status IN ('created', 'pending')
  AND job.scheduled_at <= now()
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
` as TypedSql<readonly [NamedParameter<"queue_names", string[]>], [DbJob | undefined]>;

export const getNextJobAvailableInMsSql = /* sql */ `
SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (job.scheduled_at - now())) * 1000)::bigint) AS available_in_ms
FROM queuert.job as job
WHERE job.queue_name IN (SELECT unnest($1::text[]))
  AND job.status IN ('created', 'pending')
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
` as TypedSql<
  readonly [NamedParameter<"queue_names", string[]>],
  [{ available_in_ms: number } | undefined]
>;

export const removeExpiredJobLeaseSql = /* sql */ `
WITH job_to_unlock AS (
  SELECT id
  FROM queuert.job
  WHERE leased_until IS NOT NULL
    AND leased_until < now()
    AND status = 'running'
    AND queue_name IN (SELECT unnest($1::text[]))
  ORDER BY leased_until ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE queuert.job as job
SET leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
FROM job_to_unlock
WHERE job.id = job_to_unlock.id
RETURNING job.*
` as TypedSql<readonly [NamedParameter<"queue_names", string[]>], [DbJob | undefined]>;
