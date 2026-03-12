import { type Migration, type NamedParameter, type TypedSql, sql } from "@queuert/typed-sql";

export type DbJob = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_type_name: string;
  chain_index: number;

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

  chain_trace_context: string | null;
  trace_context: string | null;
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
  chain_id                      {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  chain_type_name               text NOT NULL,
  chain_index                   integer NOT NULL,

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
  chain_trace_context           text,
  trace_context                 text
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
  trace_context                 text,
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
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}job_chain_index_idx
ON {{schema}}.{{table_prefix}}job (chain_id, chain_index)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{schema}}.{{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0`,
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
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_idx
ON {{schema}}.{{table_prefix}}job (created_at DESC) WHERE chain_index = 0`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_idx
ON {{schema}}.{{table_prefix}}job (created_at DESC)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_status_idx
ON {{schema}}.{{table_prefix}}job (status, created_at DESC)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_type_name_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at DESC)`,
          false,
        ),
      },
      {
        sql: sql(
          /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_type_name_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`,
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
    NamedParameter<"deduplication_scope", "incomplete" | "any" | null | undefined>,
    NamedParameter<"deduplication_window_ms", number | null | undefined>,
    NamedParameter<"scheduled_at", Date | null>,
    NamedParameter<"schedule_after_ms", number | null>,
    NamedParameter<"chain_trace_context", string | null>,
    NamedParameter<"trace_context", string | null>,
    NamedParameter<"chain_index", number>,
  ],
  [DbJob & { deduplicated: boolean }]
> = sql(
  /* sql */ `
WITH new_id AS (SELECT {{id_default}} AS id),
existing_continuation AS (
  SELECT *, TRUE AS deduplicated
  FROM {{schema}}.{{table_prefix}}job
  WHERE $2::{{id_type}} IS NOT NULL
    AND chain_id = $2::{{id_type}}
    AND chain_index = $12::integer
    AND id != chain_id
  LIMIT 1
),
existing_deduplicated AS (
  SELECT j.*, TRUE AS deduplicated
  FROM {{schema}}.{{table_prefix}}job j
  WHERE $5::text IS NOT NULL
    AND j.deduplication_key = $5
    AND j.chain_index = 0
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
inserted_job AS (
  INSERT INTO {{schema}}.{{table_prefix}}job (id, type_name, chain_id, chain_type_name, chain_index, input, deduplication_key, scheduled_at, chain_trace_context, trace_context)
  SELECT id, $1, COALESCE($2, id), $3,
    $12::integer,
    $4, $5,
    COALESCE($8::timestamptz, now() + ($9::bigint || ' milliseconds')::interval, now()),
    $10, $11
  FROM new_id
  WHERE NOT EXISTS (SELECT 1 FROM existing_continuation)
    AND NOT EXISTS (SELECT 1 FROM existing_deduplicated)
  ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = {{schema}}.{{table_prefix}}job.id
  RETURNING *, (id != (SELECT id FROM new_id)) AS deduplicated
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
    NamedParameter<"trace_context", (string | null)[]>,
  ],
  [DbJobWithIncompleteBlockers & { blocker_chain_trace_contexts: (string | null)[] }]
> = sql(
  /* sql */ `
WITH input_data AS (
  SELECT job_id, blocked_by_chain_id, trace_context, ord - 1 AS "index", ord
  FROM unnest($1::{{id_type}}[], $2::{{id_type}}[], $3::text[]) WITH ORDINALITY AS t(job_id, blocked_by_chain_id, trace_context, ord)
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
      ORDER BY j2.chain_index DESC
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
  SELECT id2.blocked_by_chain_id, j.chain_trace_context, id2.ord
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

export const createJobsSql: TypedSql<
  readonly [
    NamedParameter<"count", number>,
    NamedParameter<"type_names", string[]>,
    NamedParameter<"chain_ids", (string | null)[]>,
    NamedParameter<"chain_type_names", string[]>,
    NamedParameter<"chain_indexes", number[]>,
    NamedParameter<"inputs", unknown[]>,
    NamedParameter<"deduplication_keys", (string | null)[]>,
    NamedParameter<"deduplication_scopes", (string | null)[]>,
    NamedParameter<"deduplication_window_ms", (number | null)[]>,
    NamedParameter<"scheduled_ats", (string | null)[]>,
    NamedParameter<"schedule_after_ms", (number | null)[]>,
    NamedParameter<"chain_trace_contexts", (string | null)[]>,
    NamedParameter<"trace_contexts", (string | null)[]>,
  ],
  (DbJob & { deduplicated: boolean; ord: number })[]
> = sql(
  /* sql */ `
WITH generated_ids AS (
  SELECT {{id_default}} AS id, ord
  FROM generate_series(1, $1::integer) AS ord
),
input_data AS (
  SELECT
    gi.id, type_name, chain_id, chain_type_name, chain_index,
    input, dedup_key, dedup_scope, dedup_window_ms,
    scheduled_at, schedule_after_ms,
    chain_trace_context, trace_context, gi.ord
  FROM unnest(
    $2::text[], $3::{{id_type}}[], $4::text[], $5::integer[],
    $6::jsonb[], $7::text[], $8::text[], $9::bigint[],
    $10::timestamptz[], $11::bigint[],
    $12::text[], $13::text[]
  ) WITH ORDINALITY AS t(
    type_name, chain_id, chain_type_name, chain_index,
    input, dedup_key, dedup_scope, dedup_window_ms,
    scheduled_at, schedule_after_ms,
    chain_trace_context, trace_context, ord
  )
  JOIN generated_ids gi USING (ord)
),
existing_continuations AS (
  SELECT DISTINCT ON (id2.ord) id2.ord, j.*
  FROM input_data id2
  JOIN {{schema}}.{{table_prefix}}job j
    ON id2.chain_id IS NOT NULL
    AND j.chain_id = id2.chain_id
    AND j.chain_index = id2.chain_index
    AND j.id != j.chain_id
  ORDER BY id2.ord
),
existing_deduplicated AS (
  SELECT DISTINCT ON (id2.ord) id2.ord, j.*
  FROM input_data id2
  JOIN {{schema}}.{{table_prefix}}job j
    ON id2.dedup_key IS NOT NULL
    AND j.deduplication_key = id2.dedup_key
    AND j.chain_index = 0
    AND j.chain_type_name = id2.chain_type_name
    AND (
      id2.dedup_scope IS NULL
      OR (id2.dedup_scope = 'incomplete' AND j.status != 'completed')
      OR (id2.dedup_scope = 'any')
    )
    AND (
      id2.dedup_window_ms IS NULL
      OR j.created_at >= now() - (id2.dedup_window_ms || ' milliseconds')::interval
    )
  WHERE NOT EXISTS (SELECT 1 FROM existing_continuations ec WHERE ec.ord = id2.ord)
  ORDER BY id2.ord, j.created_at DESC
),
to_insert_all AS (
  SELECT id2.*
  FROM input_data id2
  WHERE NOT EXISTS (SELECT 1 FROM existing_continuations ec WHERE ec.ord = id2.ord)
    AND NOT EXISTS (SELECT 1 FROM existing_deduplicated ed WHERE ed.ord = id2.ord)
),
to_insert AS (
  SELECT tia.*
  FROM to_insert_all tia
  WHERE tia.dedup_key IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM to_insert_all tia2
      WHERE tia2.dedup_key = tia.dedup_key AND tia2.chain_type_name = tia.chain_type_name AND tia2.ord < tia.ord
    )
),
inserted_jobs AS (
  INSERT INTO {{schema}}.{{table_prefix}}job (id, type_name, chain_id, chain_type_name, chain_index, input, deduplication_key, scheduled_at, chain_trace_context, trace_context)
  SELECT
    ti.id, ti.type_name, COALESCE(ti.chain_id, ti.id), ti.chain_type_name,
    ti.chain_index, ti.input, ti.dedup_key,
    COALESCE(ti.scheduled_at, now() + (ti.schedule_after_ms || ' milliseconds')::interval, now()),
    ti.chain_trace_context, ti.trace_context
  FROM to_insert ti
  ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = {{schema}}.{{table_prefix}}job.id
  RETURNING *
)
SELECT ec.ord, ec.id, ec.type_name, ec.chain_id, ec.chain_type_name, ec.chain_index, ec.input, ec.output, ec.status, ec.created_at, ec.scheduled_at, ec.completed_at, ec.completed_by, ec.attempt, ec.last_attempt_error, ec.last_attempt_at, ec.leased_by, ec.leased_until, ec.deduplication_key, ec.chain_trace_context, ec.trace_context, TRUE AS deduplicated
FROM existing_continuations ec
UNION ALL
SELECT ed.ord, ed.id, ed.type_name, ed.chain_id, ed.chain_type_name, ed.chain_index, ed.input, ed.output, ed.status, ed.created_at, ed.scheduled_at, ed.completed_at, ed.completed_by, ed.attempt, ed.last_attempt_error, ed.last_attempt_at, ed.leased_by, ed.leased_until, ed.deduplication_key, ed.chain_trace_context, ed.trace_context, TRUE AS deduplicated
FROM existing_deduplicated ed
UNION ALL
SELECT tia.ord, ij.id, ij.type_name, ij.chain_id, ij.chain_type_name, ij.chain_index, ij.input, ij.output, ij.status, ij.created_at, ij.scheduled_at, ij.completed_at, ij.completed_by, ij.attempt, ij.last_attempt_error, ij.last_attempt_at, ij.leased_by, ij.leased_until, ij.deduplication_key, ij.chain_trace_context, ij.trace_context, TRUE AS deduplicated
FROM to_insert_all tia
JOIN to_insert ti ON ti.dedup_key = tia.dedup_key AND ti.chain_type_name = tia.chain_type_name
JOIN inserted_jobs ij ON COALESCE(ti.chain_id, ti.id) = ij.chain_id AND ti.chain_index = ij.chain_index
WHERE tia.dedup_key IS NOT NULL AND tia.ord != ti.ord
UNION ALL
SELECT ti.ord, ij.id, ij.type_name, ij.chain_id, ij.chain_type_name, ij.chain_index, ij.input, ij.output, ij.status, ij.created_at, ij.scheduled_at, ij.completed_at, ij.completed_by, ij.attempt, ij.last_attempt_error, ij.last_attempt_at, ij.leased_by, ij.leased_until, ij.deduplication_key, ij.chain_trace_context, ij.trace_context, (ij.id != ti.id) AS deduplicated
FROM inserted_jobs ij JOIN to_insert ti ON COALESCE(ti.chain_id, ti.id) = ij.chain_id AND ti.chain_index = ij.chain_index
ORDER BY ord
`,
  true,
);

export const addJobsBlockersSql: TypedSql<
  readonly [
    NamedParameter<"job_ids", string[]>,
    NamedParameter<"blocked_by_chain_ids", string[]>,
    NamedParameter<"trace_contexts", (string | null)[]>,
    NamedParameter<"blocker_indexes", number[]>,
  ],
  (DbJob & {
    source_job_id: string;
    incomplete_blocker_chain_ids: string[];
    blocker_chain_trace_contexts: (string | null)[];
  })[]
> = sql(
  /* sql */ `
WITH input_data AS (
  SELECT job_id, blocked_by_chain_id, trace_context, blocker_index AS "index", ord
  FROM unnest($1::{{id_type}}[], $2::{{id_type}}[], $3::text[], $4::integer[]) WITH ORDINALITY AS t(job_id, blocked_by_chain_id, trace_context, blocker_index, ord)
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
      ORDER BY j2.chain_index DESC
      LIMIT 1
    ) AS blocker_status
  FROM inserted_blockers ib
),
has_incomplete_blockers AS (
  SELECT DISTINCT job_id
  FROM blockers_status
  WHERE blocker_status != 'completed'
),
updated_jobs AS (
  UPDATE {{schema}}.{{table_prefix}}job j
  SET status = 'blocked'
  WHERE j.id IN (SELECT job_id FROM has_incomplete_blockers)
    AND j.status = 'pending'
  RETURNING j.*
),
distinct_job_ids AS (
  SELECT DISTINCT job_id FROM input_data
),
final_jobs AS (
  SELECT * FROM updated_jobs
  UNION ALL
  SELECT j.* FROM {{schema}}.{{table_prefix}}job j
  JOIN distinct_job_ids dj ON dj.job_id = j.id
  WHERE NOT EXISTS (SELECT 1 FROM updated_jobs uj WHERE uj.id = j.id)
),
per_job_incomplete AS (
  SELECT
    bs.job_id,
    COALESCE(array_agg(bs.blocked_by_chain_id) FILTER (WHERE bs.blocker_status != 'completed'), ARRAY[]::{{id_type}}[]) AS incomplete_blocker_chain_ids
  FROM blockers_status bs
  GROUP BY bs.job_id
),
per_job_trace_contexts AS (
  SELECT
    id2.job_id,
    json_agg(j.chain_trace_context ORDER BY id2.ord) AS blocker_chain_trace_contexts
  FROM input_data id2
  JOIN {{schema}}.{{table_prefix}}job j ON j.id = id2.blocked_by_chain_id
  GROUP BY id2.job_id
)
SELECT fj.*,
  fj.id AS source_job_id,
  COALESCE(pi.incomplete_blocker_chain_ids, ARRAY[]::{{id_type}}[]) AS incomplete_blocker_chain_ids,
  COALESCE(ptc.blocker_chain_trace_contexts, '[]'::json) AS blocker_chain_trace_contexts
FROM final_jobs fj
LEFT JOIN per_job_incomplete pi ON pi.job_id = fj.id
LEFT JOIN per_job_trace_contexts ptc ON ptc.job_id = fj.id
ORDER BY fj.id
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

export const unblockJobsSql: TypedSql<
  readonly [NamedParameter<"blocked_by_chain_id", string>],
  [{ unblocked_jobs: DbJob[]; blocker_trace_contexts: (string | null)[] }]
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
      ORDER BY j2.chain_index DESC
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
  ORDER BY chain_index DESC
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
  ORDER BY chain_index DESC
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

export const reapExpiredJobLeaseSql: TypedSql<
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

export const getConnectedChainIdsSql: TypedSql<
  readonly [NamedParameter<"seed_chain_ids", string[]>],
  { chain_id: string }[]
> = sql(
  /* sql */ `
WITH RECURSIVE connected(chain_id) AS (
  SELECT unnest($1::{{id_type}}[]) AS chain_id
  UNION
  -- jb.job_id = chain_id because blockers are added to the root job whose id = chain_id
  SELECT jb.blocked_by_chain_id AS chain_id
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  JOIN connected c ON jb.job_id = c.chain_id
)
SELECT chain_id FROM connected
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

export const deleteJobChainsSql: TypedSql<
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
FROM (SELECT * FROM _deleted_jobs WHERE chain_index = 0) AS root
LEFT JOIN LATERAL (
  SELECT *
  FROM _deleted_jobs
  WHERE chain_id = root.id
  ORDER BY chain_index DESC
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

export const getLatestChainJobForUpdateSql: TypedSql<
  readonly [NamedParameter<"chain_id", string>],
  [DbJob | undefined]
> = sql(
  /* sql */ `
SELECT *
FROM {{schema}}.{{table_prefix}}job
WHERE chain_id = $1
ORDER BY chain_index DESC
LIMIT 1
FOR UPDATE
`,
  true,
);
