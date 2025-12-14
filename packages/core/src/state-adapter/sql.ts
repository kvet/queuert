import { DeduplicationStrategy } from "../entities/job-chain.js";
import { NamedParameter, TypedSql } from "./state-adapter.pg.js";

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
    CREATE TYPE queuert.job_status AS ENUM ('created','blocked','pending','running','completed');
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

  -- deduplication
  deduplication_key             text,

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

-- Constraints: continuation deduplication
CREATE UNIQUE INDEX IF NOT EXISTS job_chain_origin_unique_idx
ON queuert.job (chain_id, origin_id)
WHERE origin_id IS NOT NULL;

-- Indexes: job acquisition
CREATE INDEX IF NOT EXISTS job_acquisition_idx
ON queuert.job (queue_name, scheduled_at)
WHERE status IN ('created', 'pending');

-- Indexes: last chain job lookup
CREATE INDEX IF NOT EXISTS job_chain_created_at_idx
ON queuert.job (chain_id, created_at DESC);

-- Indexes: deduplication lookup
CREATE INDEX IF NOT EXISTS job_deduplication_idx
ON queuert.job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL;

-- Indexes: expired lease reaping
CREATE INDEX IF NOT EXISTS job_expired_lease_idx
ON queuert.job (queue_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL;

-- Indexes: blocker lookup
CREATE INDEX IF NOT EXISTS job_blocker_chain_idx
ON queuert.job_blocker (blocked_by_chain_id);
` as TypedSql<[], void>;

export type DbJob = {
  id: string;
  queue_name: string;
  input: unknown;
  output: unknown;

  root_id: string;
  chain_id: string;
  origin_id: string | null;

  status: "created" | "blocked" | "pending" | "running" | "completed";
  created_at: string;
  scheduled_at: string;
  completed_at: string | null;

  attempt: number;
  last_attempt_error: string | null;
  last_attempt_at: string | null;

  leased_by: string | null;
  leased_until: string | null;

  deduplication_key: string | null;

  updated_at: string;
};

export const createJobSql = /* sql */ `
WITH existing_continuation AS (
  SELECT *, TRUE AS deduplicated
  FROM queuert.job
  WHERE $4::uuid IS NOT NULL
    AND $5::uuid IS NOT NULL
    AND chain_id = $4::uuid
    AND origin_id = $5::uuid
  LIMIT 1
),
existing_deduplicated AS (
  SELECT j.*, TRUE AS deduplicated
  FROM queuert.job j
  WHERE $6::text IS NOT NULL
    AND j.deduplication_key = $6
    AND j.id = j.chain_id
    AND (
      $7::text IS NULL
      OR ($7::text = 'finalized' AND j.status != 'completed')
      OR ($7::text = 'all')
    )
    AND (
      $8::bigint IS NULL
      OR j.created_at >= now() - ($8::bigint || ' milliseconds')::interval
    )
  ORDER BY j.created_at DESC
  LIMIT 1
),
new_id AS (SELECT gen_random_uuid() AS id),
inserted_job AS (
  INSERT INTO queuert.job (id, queue_name, input, root_id, chain_id, origin_id, deduplication_key)
  SELECT id, $1, $2, COALESCE($3, id), COALESCE($4, id), $5, $6
  FROM new_id
  WHERE NOT EXISTS (SELECT 1 FROM existing_continuation)
    AND NOT EXISTS (SELECT 1 FROM existing_deduplicated)
  RETURNING *, FALSE AS deduplicated
)
SELECT * FROM existing_continuation
UNION ALL
SELECT * FROM existing_deduplicated
UNION ALL
SELECT * FROM inserted_job
LIMIT 1
` as TypedSql<
  readonly [
    NamedParameter<"queue_name", string>,
    NamedParameter<"input", unknown>,
    NamedParameter<"root_id", string | undefined>,
    NamedParameter<"chain_id", string | undefined>,
    NamedParameter<"origin_id", string | undefined>,
    NamedParameter<"deduplication_key", string | null | undefined>,
    NamedParameter<"deduplication_strategy", DeduplicationStrategy | null | undefined>,
    NamedParameter<"deduplication_window_ms", number | null | undefined>,
  ],
  [DbJob & { deduplicated: boolean }]
>;

export const addJobBlockersSql = /* sql */ `
INSERT INTO queuert.job_blocker (job_id, blocked_by_chain_id, "index")
SELECT job_id, blocked_by_chain_id, ord - 1 AS "index"
FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS t(job_id, blocked_by_chain_id, ord)
` as TypedSql<
  readonly [NamedParameter<"job_id", string[]>, NamedParameter<"blocked_by_chain_id", string[]>],
  DbJob[]
>;

export const markJobAsBlockedSql = /* sql */ `
UPDATE queuert.job
SET status = 'blocked'
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
  AND j.status = 'blocked'
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
SET scheduled_at = now() + ($2::bigint || ' milliseconds')::interval,
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
  leased_until = now() + ($3::bigint || ' milliseconds')::interval,
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
