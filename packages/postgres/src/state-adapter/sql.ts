import { type Migration, type NamedParameter, type TypedSql, sql } from "@queuert/typed-sql";
import { type DeduplicationScope } from "queuert";

export type DbJob = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_type_name: string;

  input: unknown;
  output: unknown;

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

  trace_context: unknown;
};

export type DbJobWithIncompleteBlockers = DbJob & {
  incomplete_blocker_chain_ids: string[];
};

export const migrations: Migration[] = [
  {
    name: "20240101000000_initial_schema",
    statements: [
      {
        sql: sql(
          /* sql */ `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{{table_prefix}}job_status' AND typnamespace = '{{schema}}'::regnamespace) THEN
    CREATE TYPE {{schema}}.{{table_prefix}}job_status AS ENUM ('blocked','pending','running','completed');
  END IF;
END$$`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job (
  id                            {{id_type}} PRIMARY KEY DEFAULT {{id_default}},
  type_name                     text NOT NULL,
  chain_id                      {{id_type}} REFERENCES {{schema}}.{{table_prefix}}job(id),
  chain_type_name               text NOT NULL,

  input                         jsonb,
  output                        jsonb,

  -- state
  status                        {{schema}}.{{table_prefix}}job_status NOT NULL DEFAULT 'pending',
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

  -- tracing
  trace_context                 jsonb
)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_blocker (
  job_id                        {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  index                         integer NOT NULL,
  trace_context                 jsonb,
  PRIMARY KEY (job_id, blocked_by_chain_id)
)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_acquisition_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_created_at_idx
ON {{schema}}.{{table_prefix}}job (chain_id, created_at DESC)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{schema}}.{{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND id = chain_id`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_expired_lease_idx
ON {{schema}}.{{table_prefix}}job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{schema}}.{{table_prefix}}job_blocker (blocked_by_chain_id)`,
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
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}migration (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  false,
);

export const getAppliedMigrationsSql: TypedSql<[], DbMigration[]> = sql(
  /* sql */ `SELECT name, applied_at FROM {{schema}}.{{table_prefix}}migration ORDER BY name`,
  true,
);

export const recordMigrationSql: TypedSql<readonly [NamedParameter<"name", string>], void> = sql(
  /* sql */ `INSERT INTO {{schema}}.{{table_prefix}}migration (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
  false,
);

export const createJobSql: TypedSql<
  readonly [
    NamedParameter<"type_name", string>,
    NamedParameter<"chain_id", string | undefined>,
    NamedParameter<"chain_type_name", string>,
    NamedParameter<"input", unknown>,
    NamedParameter<"deduplication_key", string | null | undefined>,
    NamedParameter<"deduplication_scope", DeduplicationScope | null | undefined>,
    NamedParameter<"deduplication_window_ms", number | null | undefined>,
    NamedParameter<"scheduled_at", Date | null>,
    NamedParameter<"schedule_after_ms", number | null>,
    NamedParameter<"trace_context", unknown>,
  ],
  [DbJob & { deduplicated: boolean }]
> = sql(
  /* sql */ `
WITH existing_continuation AS (
  SELECT *, TRUE AS deduplicated
  FROM {{schema}}.{{table_prefix}}job
  WHERE $2::{{id_type}} IS NOT NULL
    AND $5::text IS NOT NULL
    AND chain_id = $2::{{id_type}}
    AND id != chain_id
    AND deduplication_key = $5
  LIMIT 1
),
existing_deduplicated AS (
  SELECT j.*, TRUE AS deduplicated
  FROM {{schema}}.{{table_prefix}}job j
  WHERE $5::text IS NOT NULL
    AND j.deduplication_key = $5
    AND j.id = j.chain_id
    AND j.chain_type_name = $3
    AND (
      $6::text IS NULL
      OR ($6::text = 'incomplete' AND j.status != 'completed')
      OR ($6::text = 'any')
    )
    AND (
      $7::bigint IS NULL
      OR j.created_at >= now() - ($7::bigint || ' milliseconds')::interval
    )
  ORDER BY j.created_at DESC
  LIMIT 1
),
new_id AS (SELECT {{id_default}} AS id),
inserted_job AS (
  INSERT INTO {{schema}}.{{table_prefix}}job (id, type_name, chain_id, chain_type_name, input, deduplication_key, scheduled_at, trace_context)
  SELECT id, $1, COALESCE($2, id), $3, $4, $5,
    COALESCE($8::timestamptz, now() + ($9::bigint || ' milliseconds')::interval, now()),
    $10
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
  readonly [
    NamedParameter<"job_id", string[]>,
    NamedParameter<"blocked_by_chain_id", string[]>,
    NamedParameter<"trace_context", unknown[]>,
  ],
  [DbJobWithIncompleteBlockers & { blocker_chain_trace_contexts: unknown[] }]
> = sql(
  /* sql */ `
WITH input_data AS (
  SELECT job_id, blocked_by_chain_id, trace_context, ord - 1 AS "index", ord
  FROM unnest($1::{{id_type}}[], $2::{{id_type}}[], $3::jsonb[]) WITH ORDINALITY AS t(job_id, blocked_by_chain_id, trace_context, ord)
),
inserted_blockers AS (
  INSERT INTO {{schema}}.{{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
  SELECT job_id, blocked_by_chain_id, "index", trace_context
  FROM input_data
  RETURNING job_id, blocked_by_chain_id
),
blockers_status AS (
  SELECT
    ib.job_id,
    ib.blocked_by_chain_id,
    (
      SELECT j2.status
      FROM {{schema}}.{{table_prefix}}job j2
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
  UPDATE {{schema}}.{{table_prefix}}job j
  SET status = 'blocked'
  WHERE j.id IN (SELECT job_id FROM has_incomplete_blockers)
    AND j.status = 'pending'
  RETURNING j.*
),
final_job AS (
  SELECT * FROM updated_job
  UNION ALL
  SELECT j.* FROM {{schema}}.{{table_prefix}}job j
  WHERE j.id = (SELECT DISTINCT job_id FROM inserted_blockers LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM updated_job)
  LIMIT 1
),
blocker_chain_contexts AS (
  SELECT id2.blocked_by_chain_id, j.trace_context AS chain_trace_context, id2.ord
  FROM input_data id2
  JOIN {{schema}}.{{table_prefix}}job j ON j.id = id2.blocked_by_chain_id
)
SELECT fj.*,
  COALESCE((SELECT array_agg(blocked_by_chain_id) FROM incomplete_blockers), ARRAY[]::{{id_type}}[]) AS incomplete_blocker_chain_ids,
  COALESCE((SELECT json_agg(bcc.chain_trace_context ORDER BY bcc.ord) FROM blocker_chain_contexts bcc), '[]'::json) AS blocker_chain_trace_contexts
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
UPDATE {{schema}}.{{table_prefix}}job
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
  [{ unblocked_jobs: DbJob[]; blocker_trace_contexts: unknown[] }]
> = sql(
  /* sql */ `
WITH direct_blocked AS (
  SELECT DISTINCT jb.job_id
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.blocked_by_chain_id = $1
),
blockers_status AS (
  SELECT
    jb.job_id,
    jb.blocked_by_chain_id,
    (
      SELECT j2.status
      FROM {{schema}}.{{table_prefix}}job j2
      WHERE j2.chain_id = jb.blocked_by_chain_id
      ORDER BY j2.created_at DESC
      LIMIT 1
    ) AS blocker_status
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.job_id IN (SELECT job_id FROM direct_blocked)
),
ready_jobs AS (
  SELECT job_id
  FROM blockers_status
  GROUP BY job_id
  HAVING bool_and(blocker_status = 'completed')
),
updated AS (
  UPDATE {{schema}}.{{table_prefix}}job j
  SET scheduled_at = now(),
    status = 'pending'
  WHERE j.id IN (SELECT job_id FROM ready_jobs)
    AND j.status = 'blocked'
  RETURNING j.*
),
trace_contexts AS (
  SELECT jb.trace_context
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  WHERE jb.blocked_by_chain_id = $1
    AND jb.trace_context IS NOT NULL
)
SELECT
  COALESCE((SELECT json_agg(row_to_json(u)) FROM updated u), '[]'::json) AS unblocked_jobs,
  COALESCE((SELECT json_agg(tc.trace_context) FROM trace_contexts tc), '[]'::json) AS blocker_trace_contexts;
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
FROM {{schema}}.{{table_prefix}}job AS j
LEFT JOIN LATERAL (
  SELECT *
  FROM {{schema}}.{{table_prefix}}job
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
FROM {{schema}}.{{table_prefix}}job_blocker AS b
JOIN {{schema}}.{{table_prefix}}job AS j
  ON j.id = b.blocked_by_chain_id
LEFT JOIN LATERAL (
  SELECT *
  FROM {{schema}}.{{table_prefix}}job
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
FROM {{schema}}.{{table_prefix}}job
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
UPDATE {{schema}}.{{table_prefix}}job
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
UPDATE {{schema}}.{{table_prefix}}job
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
  FROM {{schema}}.{{table_prefix}}job
  WHERE type_name IN (SELECT unnest($1::text[]))
    AND status = 'pending'
    AND scheduled_at <= now()
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE {{schema}}.{{table_prefix}}job
SET status = 'running',
    attempt = attempt + 1
WHERE id = (SELECT id FROM acquired_job)
RETURNING *,
  EXISTS(
    SELECT 1 FROM {{schema}}.{{table_prefix}}job
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
FROM {{schema}}.{{table_prefix}}job as job
WHERE job.type_name IN (SELECT unnest($1::text[]))
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
`,
  true,
);

export const removeExpiredJobLeaseSql: TypedSql<
  readonly [NamedParameter<"type_names", string[]>, NamedParameter<"ignored_job_ids", string[]>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
WITH job_to_unlock AS (
  SELECT id
  FROM {{schema}}.{{table_prefix}}job
  WHERE leased_until IS NOT NULL
    AND leased_until <= now()
    AND status = 'running'
    AND type_name IN (SELECT unnest($1::text[]))
    AND id != ALL($2::{{id_type}}[])
  ORDER BY leased_until ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE {{schema}}.{{table_prefix}}job as job
SET leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
FROM job_to_unlock
WHERE job.id = job_to_unlock.id
RETURNING job.*
`,
  true,
);

export const checkExternalBlockerRefsSql: TypedSql<
  readonly [NamedParameter<"chain_ids_1", string[]>, NamedParameter<"chain_ids_2", string[]>],
  { job_id: string; blocked_by_chain_id: string }[]
> = sql(
  /* sql */ `
WITH _locked AS (
  -- Lock all jobs in chains being deleted to prevent concurrent mutations
  -- between the check and the subsequent DELETE.
  -- Rows are locked in ctid order (physical), so concurrent deletes on
  -- overlapping chain sets acquire locks in the same order — no deadlock.
  SELECT id FROM {{schema}}.{{table_prefix}}job
  WHERE chain_id = ANY($1::{{id_type}}[])
  ORDER BY ctid
  FOR UPDATE
)
SELECT jb.job_id, jb.blocked_by_chain_id
FROM {{schema}}.{{table_prefix}}job_blocker jb
JOIN {{schema}}.{{table_prefix}}job j ON j.id = jb.job_id
WHERE jb.blocked_by_chain_id = ANY($1::{{id_type}}[])
  AND j.chain_id != ALL($2::{{id_type}}[])
`,
  true,
);

export const deleteJobsByChainIdsSql: TypedSql<
  readonly [NamedParameter<"chain_ids", string[]>],
  { root_job: DbJob; last_chain_job: DbJob | null }[]
> = sql(
  /* sql */ `
WITH _deleted_blockers AS (
  DELETE FROM {{schema}}.{{table_prefix}}job_blocker
  WHERE job_id IN (
    SELECT id FROM {{schema}}.{{table_prefix}}job WHERE chain_id = ANY($1::{{id_type}}[])
  )
),
_deleted_jobs AS (
  DELETE FROM {{schema}}.{{table_prefix}}job
  WHERE chain_id = ANY($1::{{id_type}}[])
  RETURNING *
)
SELECT
  row_to_json(root) AS root_job,
  row_to_json(lc) AS last_chain_job
FROM (SELECT * FROM _deleted_jobs WHERE id = chain_id) AS root
LEFT JOIN LATERAL (
  SELECT *
  FROM _deleted_jobs
  WHERE chain_id = root.id
  ORDER BY created_at DESC
  LIMIT 1
) AS lc ON TRUE
`,
  true,
);

export const getJobForUpdateSql: TypedSql<
  readonly [NamedParameter<"id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
SELECT *
FROM {{schema}}.{{table_prefix}}job
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
FROM {{schema}}.{{table_prefix}}job
WHERE chain_id = $1
ORDER BY created_at DESC
LIMIT 1
FOR UPDATE
`,
  true,
);
