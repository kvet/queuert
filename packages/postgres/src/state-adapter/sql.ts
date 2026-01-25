import {
  type MigrationStatement,
  type NamedParameter,
  type TypedSql,
  sql,
} from "@queuert/typed-sql";
import { type DeduplicationStrategy } from "queuert";

export type DbJob = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_type_name: string;

  input: unknown;
  output: unknown;

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

export type DbJobWithIncompleteBlockers = DbJob & {
  incomplete_blocker_chain_ids: string[];
};

export const migrationStatements: MigrationStatement[] = [
  // Types: job_status enum
  {
    sql: sql(
      /* sql */ `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status' AND typnamespace = '{{schema}}'::regnamespace) THEN
    CREATE TYPE {{schema}}.job_status AS ENUM ('blocked','pending','running','completed');
  END IF;
END$$`,
      false,
    ),
  },

  // Tables: job table
  {
    sql: sql(
      /* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.job (
  id                            {{id_type}} PRIMARY KEY DEFAULT {{id_default}},
  type_name                     text NOT NULL,
  chain_id                      {{id_type}} REFERENCES {{schema}}.job(id) ON DELETE CASCADE,
  chain_type_name               text NOT NULL,

  input                         jsonb,
  output                        jsonb,

  -- lineage / tracing
  root_chain_id                 {{id_type}} REFERENCES {{schema}}.job(id) ON DELETE CASCADE,
  origin_id                     {{id_type}} REFERENCES {{schema}}.job(id) ON DELETE CASCADE,

  -- state
  status                        {{schema}}.job_status NOT NULL DEFAULT 'pending',
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,
  completed_by                  text,

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
)`,
      false,
    ),
  },

  // Tables: job_blocker table
  {
    sql: sql(
      /* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.job_blocker (
  job_id                        {{id_type}} NOT NULL REFERENCES {{schema}}.job(id) ON DELETE CASCADE,
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{schema}}.job(id) ON DELETE CASCADE,
  index                         integer NOT NULL,
  PRIMARY KEY (job_id, blocked_by_chain_id)
)`,
      false,
    ),
  },

  // Triggers: updated_at trigger function
  {
    sql: sql(
      /* sql */ `
CREATE OR REPLACE FUNCTION {{schema}}.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql`,
      false,
    ),
  },

  // Triggers: drop existing trigger
  {
    sql: sql(/* sql */ `DROP TRIGGER IF EXISTS update_job_updated_at ON {{schema}}.job`, false),
  },

  // Triggers: create trigger
  {
    sql: sql(
      /* sql */ `
CREATE TRIGGER update_job_updated_at
BEFORE UPDATE ON {{schema}}.job
FOR EACH ROW
EXECUTE PROCEDURE {{schema}}.update_updated_at_column()`,
      false,
    ),
  },

  // Constraints: continuation deduplication
  {
    sql: sql(
      /* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS job_chain_origin_unique_idx
ON {{schema}}.job (chain_id, origin_id)
WHERE origin_id IS NOT NULL`,
      false,
    ),
  },

  // Indexes: job acquisition
  {
    sql: sql(
      /* sql */ `
CREATE INDEX IF NOT EXISTS job_acquisition_idx
ON {{schema}}.job (type_name, scheduled_at)
WHERE status = 'pending'`,
      false,
    ),
  },

  // Indexes: last chain job lookup
  {
    sql: sql(
      /* sql */ `
CREATE INDEX IF NOT EXISTS job_chain_created_at_idx
ON {{schema}}.job (chain_id, created_at DESC)`,
      false,
    ),
  },

  // Indexes: deduplication lookup
  {
    sql: sql(
      /* sql */ `
CREATE INDEX IF NOT EXISTS job_deduplication_idx
ON {{schema}}.job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL`,
      false,
    ),
  },

  // Indexes: expired lease reaping
  {
    sql: sql(
      /* sql */ `
CREATE INDEX IF NOT EXISTS job_expired_lease_idx
ON {{schema}}.job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`,
      false,
    ),
  },

  // Indexes: blocker lookup
  {
    sql: sql(
      /* sql */ `
CREATE INDEX IF NOT EXISTS job_blocker_chain_idx
ON {{schema}}.job_blocker (blocked_by_chain_id)`,
      false,
    ),
  },
];

export const createJobSql: TypedSql<
  readonly [
    NamedParameter<"type_name", string>,
    NamedParameter<"chain_id", string | undefined>,
    NamedParameter<"chain_type_name", string>,
    NamedParameter<"input", unknown>,
    NamedParameter<"root_chain_id", string | undefined>,
    NamedParameter<"origin_id", string | undefined>,
    NamedParameter<"deduplication_key", string | null | undefined>,
    NamedParameter<"deduplication_strategy", DeduplicationStrategy | null | undefined>,
    NamedParameter<"deduplication_window_ms", number | null | undefined>,
    NamedParameter<"scheduled_at", Date | null>,
    NamedParameter<"schedule_after_ms", number | null>,
  ],
  [DbJob & { deduplicated: boolean }]
> = sql(
  /* sql */ `
WITH existing_continuation AS (
  SELECT *, TRUE AS deduplicated
  FROM {{schema}}.job
  WHERE $2::{{id_type}} IS NOT NULL
    AND $6::{{id_type}} IS NOT NULL
    AND chain_id = $2::{{id_type}}
    AND origin_id = $6::{{id_type}}
  LIMIT 1
),
existing_deduplicated AS (
  SELECT j.*, TRUE AS deduplicated
  FROM {{schema}}.job j
  WHERE $7::text IS NOT NULL
    AND j.deduplication_key = $7
    AND j.id = j.chain_id
    AND (
      $8::text IS NULL
      OR ($8::text = 'completed' AND j.status != 'completed')
      OR ($8::text = 'all')
    )
    AND (
      $9::bigint IS NULL
      OR j.created_at >= now() - ($9::bigint || ' milliseconds')::interval
    )
  ORDER BY j.created_at DESC
  LIMIT 1
),
new_id AS (SELECT {{id_default}} AS id),
inserted_job AS (
  INSERT INTO {{schema}}.job (id, type_name, chain_id, chain_type_name, input, root_chain_id, origin_id, deduplication_key, scheduled_at)
  SELECT id, $1, COALESCE($2, id), $3, $4, COALESCE($5, id), $6, $7,
    COALESCE($10::timestamptz, now() + ($11::bigint || ' milliseconds')::interval, now())
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
`,
  true,
);

export const addJobBlockersSql: TypedSql<
  readonly [NamedParameter<"job_id", string[]>, NamedParameter<"blocked_by_chain_id", string[]>],
  [DbJobWithIncompleteBlockers]
> = sql(
  /* sql */ `
WITH inserted_blockers AS (
  INSERT INTO {{schema}}.job_blocker (job_id, blocked_by_chain_id, "index")
  SELECT job_id, blocked_by_chain_id, ord - 1 AS "index"
  FROM unnest($1::{{id_type}}[], $2::{{id_type}}[]) WITH ORDINALITY AS t(job_id, blocked_by_chain_id, ord)
  RETURNING job_id, blocked_by_chain_id
),
blockers_status AS (
  SELECT
    ib.job_id,
    ib.blocked_by_chain_id,
    (
      SELECT j2.status
      FROM {{schema}}.job j2
      WHERE j2.chain_id = ib.blocked_by_chain_id
      ORDER BY j2.created_at DESC
      LIMIT 1
    ) AS blocker_status
  FROM inserted_blockers ib
),
incomplete_blockers AS (
  SELECT blocked_by_chain_id
  FROM blockers_status
  WHERE blocker_status != 'completed'
),
has_incomplete_blockers AS (
  SELECT DISTINCT job_id
  FROM blockers_status
  WHERE blocker_status != 'completed'
),
updated_job AS (
  UPDATE {{schema}}.job j
  SET status = 'blocked'
  WHERE j.id IN (SELECT job_id FROM has_incomplete_blockers)
    AND j.status = 'pending'
  RETURNING j.*
),
final_job AS (
  SELECT * FROM updated_job
  UNION ALL
  SELECT j.* FROM {{schema}}.job j
  WHERE j.id = (SELECT DISTINCT job_id FROM inserted_blockers LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM updated_job)
  LIMIT 1
)
SELECT fj.*,
  COALESCE((SELECT array_agg(blocked_by_chain_id) FROM incomplete_blockers), ARRAY[]::{{id_type}}[]) AS incomplete_blocker_chain_ids
FROM final_job fj;
`,
  true,
);

export const completeJobSql: TypedSql<
  readonly [
    NamedParameter<"id", string>,
    NamedParameter<"output", unknown>,
    NamedParameter<"completed_by", string | null>,
  ],
  [DbJob]
> = sql(
  /* sql */ `
UPDATE {{schema}}.job
SET status = 'completed',
  completed_at = now(),
  completed_by = $3,
  output = $2,
  leased_by = NULL,
  leased_until = NULL
WHERE id = $1
RETURNING *
`,
  true,
);

export const scheduleBlockedJobsSql: TypedSql<
  readonly [NamedParameter<"blocked_by_chain_id", string>],
  DbJob[]
> = sql(
  /* sql */ `
WITH direct_blocked AS (
  SELECT DISTINCT jb.job_id
  FROM {{schema}}.job_blocker jb
  WHERE jb.blocked_by_chain_id = $1
),
blockers_status AS (
  SELECT
    jb.job_id,
    jb.blocked_by_chain_id,
    (
      SELECT j2.status
      FROM {{schema}}.job j2
      WHERE j2.chain_id = jb.blocked_by_chain_id
      ORDER BY j2.created_at DESC
      LIMIT 1
    ) AS blocker_status
  FROM {{schema}}.job_blocker jb
  WHERE jb.job_id IN (SELECT job_id FROM direct_blocked)
),
ready_jobs AS (
  SELECT job_id
  FROM blockers_status
  GROUP BY job_id
  HAVING bool_and(blocker_status = 'completed')
)
UPDATE {{schema}}.job j
SET scheduled_at = now(),
  status = 'pending'
WHERE j.id IN (SELECT job_id FROM ready_jobs)
  AND j.status = 'blocked'
RETURNING j.*;
`,
  true,
);

export const getJobChainByIdSql: TypedSql<
  readonly [NamedParameter<"id", string>],
  [{ root_job: DbJob; last_chain_job: DbJob | null } | undefined]
> = sql(
  /* sql */ `
SELECT
  row_to_json(j)  AS root_job,
  row_to_json(lc) AS last_chain_job
FROM {{schema}}.job AS j
LEFT JOIN LATERAL (
  SELECT *
  FROM {{schema}}.job
  WHERE chain_id = j.id
  ORDER BY created_at DESC
  LIMIT 1
) AS lc ON TRUE
WHERE j.id = $1
`,
  true,
);

export const getJobBlockersSql: TypedSql<
  readonly [NamedParameter<"id", string>],
  { root_job: DbJob; last_chain_job: DbJob | null }[]
> = sql(
  /* sql */ `
SELECT
  row_to_json(j)   AS root_job,
  row_to_json(lc)  AS last_chain_job
FROM {{schema}}.job_blocker AS b
JOIN {{schema}}.job AS j
  ON j.id = b.blocked_by_chain_id
LEFT JOIN LATERAL (
  SELECT *
  FROM {{schema}}.job
  WHERE chain_id = j.id
  ORDER BY created_at DESC
  LIMIT 1
) AS lc ON TRUE
WHERE b.job_id = $1
ORDER BY b.index ASC
`,
  true,
);

export const getJobByIdSql: TypedSql<readonly [NamedParameter<"id", string>], [DbJob | undefined]> =
  sql(
    /* sql */ `
SELECT *
FROM {{schema}}.job
WHERE id = $1
`,
    true,
  );

export const rescheduleJobSql: TypedSql<
  readonly [
    NamedParameter<"id", string>,
    NamedParameter<"scheduled_at", Date | null>,
    NamedParameter<"schedule_after_ms", number | null>,
    NamedParameter<"error", string>,
  ],
  [DbJob]
> = sql(
  /* sql */ `
UPDATE {{schema}}.job
SET scheduled_at = COALESCE($2::timestamptz, now() + ($3::bigint || ' milliseconds')::interval, now()),
  last_attempt_at = now(),
  last_attempt_error = $4,
  leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = $1
RETURNING *
`,
  true,
);

export const renewJobLeaseSql: TypedSql<
  readonly [
    NamedParameter<"id", string>,
    NamedParameter<"leased_by", string>,
    NamedParameter<"lease_duration_ms", number>,
  ],
  [DbJob]
> = sql(
  /* sql */ `
UPDATE {{schema}}.job
SET leased_by = $2,
  leased_until = now() + ($3::bigint || ' milliseconds')::interval,
  status = 'running'
WHERE id = $1
RETURNING *
`,
  true,
);

export type DbJobWithHasMore = DbJob & { has_more: boolean };

export const acquireJobSql: TypedSql<
  readonly [NamedParameter<"type_names", string[]>],
  [DbJobWithHasMore | undefined]
> = sql(
  /* sql */ `
WITH acquired_job AS (
  SELECT id
  FROM {{schema}}.job
  WHERE type_name IN (SELECT unnest($1::text[]))
    AND status = 'pending'
    AND scheduled_at <= now()
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE {{schema}}.job
SET status = 'running',
    attempt = attempt + 1
WHERE id = (SELECT id FROM acquired_job)
RETURNING *,
  EXISTS(
    SELECT 1 FROM {{schema}}.job
    WHERE type_name IN (SELECT unnest($1::text[]))
      AND status = 'pending'
      AND scheduled_at <= now()
    LIMIT 1
  ) AS has_more
`,
  true,
);

export const getNextJobAvailableInMsSql: TypedSql<
  readonly [NamedParameter<"type_names", string[]>],
  [{ available_in_ms: number } | undefined]
> = sql(
  /* sql */ `
SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (job.scheduled_at - now())) * 1000))::integer AS available_in_ms
FROM {{schema}}.job as job
WHERE job.type_name IN (SELECT unnest($1::text[]))
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
`,
  true,
);

export const removeExpiredJobLeaseSql: TypedSql<
  readonly [NamedParameter<"type_names", string[]>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
WITH job_to_unlock AS (
  SELECT id
  FROM {{schema}}.job
  WHERE leased_until IS NOT NULL
    AND leased_until < now()
    AND status = 'running'
    AND type_name IN (SELECT unnest($1::text[]))
  ORDER BY leased_until ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE {{schema}}.job as job
SET leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
FROM job_to_unlock
WHERE job.id = job_to_unlock.id
RETURNING job.*
`,
  true,
);

export const getExternalBlockersSql: TypedSql<
  readonly [NamedParameter<"root_chain_ids", string[]>],
  { job_id: string; blocked_root_chain_id: string }[]
> = sql(
  /* sql */ `
SELECT DISTINCT jb.job_id, j.root_chain_id AS blocked_root_chain_id
FROM {{schema}}.job_blocker jb
JOIN {{schema}}.job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id IN (
  SELECT id FROM {{schema}}.job WHERE root_chain_id = ANY($1::{{id_type}}[])
)
AND j.root_chain_id != ALL($1::{{id_type}}[])
`,
  true,
);

export const deleteJobsByRootChainIdsSql: TypedSql<
  readonly [NamedParameter<"root_chain_ids", string[]>],
  DbJob[]
> = sql(
  /* sql */ `
DELETE FROM {{schema}}.job
WHERE root_chain_id = ANY($1::{{id_type}}[])
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
FROM {{schema}}.job
WHERE id = $1
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
FROM {{schema}}.job
WHERE chain_id = $1
ORDER BY created_at DESC
LIMIT 1
FOR UPDATE
`,
  true,
);
