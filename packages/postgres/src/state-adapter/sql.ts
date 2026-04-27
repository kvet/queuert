import {
  type DataType,
  type Migration,
  type RuntimeType,
  type TypedSql,
  sql,
  t,
} from "@queuert/typed-sql";

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

export const migrations: Migration[] = [
  {
    name: "20240101000000_initial_schema",
    statements: [
      {
        sql: sql(/* sql */ `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{{table_prefix}}job_status' AND typnamespace = '{{schema}}'::regnamespace) THEN
    CREATE TYPE {{schema}}.{{table_prefix}}job_status AS ENUM ('blocked','pending','running','completed');
  END IF;
END$$`),
      },
      {
        sql: sql(/* sql */ `
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
)`),
      },
      {
        sql: sql(/* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_blocker (
  job_id                        {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  blocked_by_chain_id           {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  index                         integer NOT NULL,
  trace_context                 text,
  PRIMARY KEY (job_id, blocked_by_chain_id)
)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_acquisition_idx
ON {{schema}}.{{table_prefix}}job (type_name, scheduled_at)
WHERE status = 'pending'`),
      },
      {
        sql: sql(/* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}job_chain_index_idx
ON {{schema}}.{{table_prefix}}job (chain_id, chain_index)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_deduplication_idx
ON {{schema}}.{{table_prefix}}job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_expired_lease_idx
ON {{schema}}.{{table_prefix}}job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{schema}}.{{table_prefix}}job_blocker (blocked_by_chain_id)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_idx
ON {{schema}}.{{table_prefix}}job (created_at DESC) WHERE chain_index = 0`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_idx
ON {{schema}}.{{table_prefix}}job (created_at DESC)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_status_idx
ON {{schema}}.{{table_prefix}}job (status, created_at DESC)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_listing_type_name_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at DESC)`),
      },
      {
        sql: sql(/* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_chain_listing_type_name_idx
ON {{schema}}.{{table_prefix}}job (type_name, created_at DESC) WHERE chain_index = 0`),
      },
    ],
  },
  {
    name: "20240102000000_vacuum_tuning",
    statements: [
      {
        sql: sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job SET (
  fillfactor = 75,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 0
)`),
      },
      {
        sql: sql(/* sql */ `
ALTER TABLE {{schema}}.{{table_prefix}}job_blocker SET (
  autovacuum_vacuum_cost_delay = 0
)`),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Column type aliases (used to annotate PgSqlDefinitions)
// ---------------------------------------------------------------------------

type Id = DataType<RuntimeType, string>;

type PgDbJobCols = {
  readonly id: Id;
  readonly chain_id: Id;
  readonly type_name: DataType<"string", string>;
  readonly chain_type_name: DataType<"string", string>;
  readonly chain_index: DataType<"number", number>;
  readonly input: DataType<"json">;
  readonly output: DataType<"json">;
  readonly status: DataType<"string", DbJob["status"]>;
  readonly created_at: DataType<"string", string>;
  readonly scheduled_at: DataType<"string", string>;
  readonly completed_at: DataType<"string?", string | null>;
  readonly completed_by: DataType<"string?", string | null>;
  readonly attempt: DataType<"number", number>;
  readonly last_attempt_error: DataType<"json?", string | null>;
  readonly last_attempt_at: DataType<"string?", string | null>;
  readonly leased_by: DataType<"string?", string | null>;
  readonly leased_until: DataType<"string?", string | null>;
  readonly deduplication_key: DataType<"string?", string | null>;
  readonly chain_trace_context: DataType<"string?", string | null>;
  readonly trace_context: DataType<"string?", string | null>;
};

type PgRowToJsonCols = {
  readonly root_job: DataType<"json", DbJob>;
  readonly last_chain_job: DataType<"json?", DbJob | null>;
};

// ---------------------------------------------------------------------------
// PgSqlDefinitions — explicit return type for createPgSqlDefinitions
// ---------------------------------------------------------------------------

export type PgSqlDefinitions = {
  readonly dbJobColumns: PgDbJobCols;
  readonly rowToJsonJobColumns: PgRowToJsonCols;
  readonly createMigrationTableSql: TypedSql<readonly [], Record<string, never>>;
  readonly getAppliedMigrationsSql: TypedSql<
    readonly [],
    { readonly name: DataType<"string", string>; readonly applied_at: DataType<"string", string> }
  >;
  readonly recordMigrationSql: TypedSql<
    readonly [DataType<"string", string>],
    Record<string, never>
  >;
  readonly createJobsSql: TypedSql<
    readonly [
      DataType<"number", number>,
      DataType<"array", string[]>,
      DataType<"array", (string | null)[]>,
      DataType<"array", string[]>,
      DataType<"array", number[]>,
      DataType<"jsonArray", unknown[]>,
      DataType<"array", (string | null)[]>,
      DataType<"array", (string | null)[]>,
      DataType<"array", (number | null)[]>,
      DataType<"array", (string | null)[]>,
      DataType<"array", (string | null)[]>,
      DataType<"array", (number | null)[]>,
      DataType<"array", (string | null)[]>,
      DataType<"array", (string | null)[]>,
    ],
    PgDbJobCols & {
      readonly deduplicated: DataType<"boolean", boolean>;
      readonly ord: DataType<"number", number>;
    }
  >;
  readonly addJobsBlockersSql: TypedSql<
    readonly [
      DataType<"array", string[]>,
      DataType<"array", string[]>,
      DataType<"array", (string | null)[]>,
      DataType<"array", number[]>,
    ],
    PgDbJobCols & {
      readonly source_job_id: Id;
      readonly incomplete_blocker_chain_ids: DataType<"array", string[]>;
      readonly blocker_chain_trace_contexts: DataType<"json", (string | null)[]>;
    }
  >;
  readonly completeJobSql: TypedSql<
    readonly [Id, DataType<"json">, DataType<"string?", string | null>],
    PgDbJobCols
  >;
  readonly unblockJobsSql: TypedSql<
    readonly [Id],
    {
      readonly unblocked_jobs: DataType<"json", DbJob[]>;
      readonly blocker_trace_contexts: DataType<"json", (string | null)[]>;
    }
  >;
  readonly getJobChainByIdSql: TypedSql<readonly [Id], PgRowToJsonCols>;
  readonly getJobBlockersSql: TypedSql<readonly [Id], PgRowToJsonCols>;
  readonly getJobByIdSql: TypedSql<readonly [Id], PgDbJobCols>;
  readonly rescheduleJobSql: TypedSql<
    readonly [
      Id,
      DataType<"date?", string | null>,
      DataType<"number?", number | null>,
      DataType<"string", string>,
    ],
    PgDbJobCols
  >;
  readonly triggerJobsSql: TypedSql<
    readonly [DataType<"array", string[]>],
    {
      readonly triggered: DataType<"json", DbJob[]>;
      readonly not_found: DataType<"json", string[]>;
      readonly not_triggerable: DataType<"json", { id: string; status: string }[]>;
    }
  >;
  readonly renewJobLeaseSql: TypedSql<
    readonly [Id, DataType<"string", string>, DataType<"number", number>],
    PgDbJobCols
  >;
  readonly acquireJobSql: TypedSql<
    readonly [DataType<"array", string[]>],
    PgDbJobCols & { readonly has_more: DataType<"boolean", boolean> }
  >;
  readonly getNextJobAvailableInMsSql: TypedSql<
    readonly [DataType<"array", string[]>],
    { readonly available_in_ms: DataType<"number", number> }
  >;
  readonly reapExpiredJobLeaseSql: TypedSql<
    readonly [DataType<"array", string[]>, DataType<"array", string[]>],
    PgDbJobCols
  >;
  readonly getConnectedChainIdsSql: TypedSql<
    readonly [DataType<"array", string[]>],
    { readonly chain_id: Id }
  >;
  readonly deleteJobChainsSql: TypedSql<
    readonly [DataType<"array", string[]>],
    {
      readonly deleted: DataType<
        "json",
        { readonly root_job: DbJob; readonly last_chain_job: DbJob | null }[]
      >;
      readonly blocker_refs: DataType<
        "json",
        { readonly job_id: string; readonly blocked_by_chain_id: string }[]
      >;
    }
  >;
  readonly getJobForUpdateSql: TypedSql<readonly [Id], PgDbJobCols>;
  readonly getLatestChainJobForUpdateSql: TypedSql<readonly [Id], PgDbJobCols>;
};

export const createPgSqlDefinitions = (id: DataType<RuntimeType, string>): PgSqlDefinitions => {
  const dbJobColumns = {
    id,
    chain_id: id,
    type_name: t.string(),
    chain_type_name: t.string(),
    chain_index: t.number(),
    input: t.json(),
    output: t.json(),
    status: t.string<DbJob["status"]>(),
    created_at: t.string(),
    scheduled_at: t.string(),
    completed_at: t["string?"](),
    completed_by: t["string?"](),
    attempt: t.number(),
    last_attempt_error: t["json?"]<string>(),
    last_attempt_at: t["string?"](),
    leased_by: t["string?"](),
    leased_until: t["string?"](),
    deduplication_key: t["string?"](),
    chain_trace_context: t["string?"](),
    trace_context: t["string?"](),
  } as const;

  const rowToJsonJobColumns = {
    root_job: t.json<DbJob>(),
    last_chain_job: t["json?"]<DbJob>(),
  } as const;

  const createMigrationTableSql = sql(
    /* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}migration (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
    {
      id: "createMigrationTable",
      params: [],
      columns: {},
    },
  );

  const getAppliedMigrationsSql = sql(
    /* sql */ `SELECT name, applied_at FROM {{schema}}.{{table_prefix}}migration ORDER BY name`,
    {
      id: "getAppliedMigrations",
      params: [],
      columns: { name: t.string(), applied_at: t.string() },
      readOnly: true,
    },
  );

  const recordMigrationSql = sql(
    /* sql */ `INSERT INTO {{schema}}.{{table_prefix}}migration (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
    {
      id: "recordMigration",
      params: [t.string()],
      columns: {},
    },
  );

  const createJobsSql = sql(
    /* sql */ `
WITH generated_ids AS (
  SELECT {{id_default}} AS id, ord
  FROM generate_series(1, $1::integer) AS ord
),
input_data AS (
  SELECT
    gi.id, type_name, chain_id, chain_type_name, chain_index,
    input, dedup_key, dedup_scope, dedup_window_ms, dedup_exclude_chain_ids,
    scheduled_at, schedule_after_ms,
    chain_trace_context, trace_context, gi.ord
  FROM unnest(
    $2::text[], $3::{{id_type}}[], $4::text[], $5::integer[],
    $6::jsonb[], $7::text[], $8::text[], $9::bigint[],
    $10::text[],
    $11::timestamptz[], $12::bigint[],
    $13::text[], $14::text[]
  ) WITH ORDINALITY AS t(
    type_name, chain_id, chain_type_name, chain_index,
    input, dedup_key, dedup_scope, dedup_window_ms, dedup_exclude_chain_ids,
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
    AND (
      id2.dedup_exclude_chain_ids IS NULL
      OR j.chain_id != ALL(ARRAY(SELECT jsonb_array_elements_text(id2.dedup_exclude_chain_ids::jsonb))::{{id_type}}[])
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
    {
      id: "createJobs",
      params: [
        t.number(),
        t.array(),
        t.array<string | null>(),
        t.array(),
        t.array<number>(),
        t.jsonArray(),
        t.array<string | null>(),
        t.array<string | null>(),
        t.array<number | null>(),
        t.array<string | null>(),
        t.array<string | null>(),
        t.array<number | null>(),
        t.array<string | null>(),
        t.array<string | null>(),
      ],
      columns: { ...dbJobColumns, deduplicated: t.boolean(), ord: t.number() },
    },
  );

  const addJobsBlockersSql = sql(
    /* sql */ `
WITH input_data AS (
  SELECT job_id, blocked_by_chain_id, trace_context, blocker_index AS "index", ord
  FROM unnest($1::{{id_type}}[], $2::{{id_type}}[], $3::text[], $4::integer[]) WITH ORDINALITY AS t(job_id, blocked_by_chain_id, trace_context, blocker_index, ord)
),
locked_blocker_chain_latest AS (
  SELECT j.id, j.chain_id, j.status
  FROM {{schema}}.{{table_prefix}}job j
  WHERE j.chain_id IN (SELECT DISTINCT blocked_by_chain_id FROM input_data)
    AND NOT EXISTS (
      SELECT 1 FROM {{schema}}.{{table_prefix}}job j2
      WHERE j2.chain_id = j.chain_id AND j2.chain_index > j.chain_index
    )
  ORDER BY j.id
  FOR UPDATE
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
    lbcl.status AS blocker_status
  FROM inserted_blockers ib
  LEFT JOIN locked_blocker_chain_latest lbcl ON lbcl.chain_id = ib.blocked_by_chain_id
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
    {
      id: "addJobsBlockers",
      params: [t.array(), t.array(), t.array<string | null>(), t.array<number>()],
      columns: {
        ...dbJobColumns,
        source_job_id: id,
        incomplete_blocker_chain_ids: t.array(),
        blocker_chain_trace_contexts: t.json<(string | null)[]>(),
      },
    },
  );

  const completeJobSql = sql(
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
    {
      id: "completeJob",
      params: [id, t.json(), t["string?"]()],
      columns: { ...dbJobColumns },
    },
  );

  const unblockJobsSql = sql(
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
    {
      id: "unblockJobs",
      params: [id],
      columns: {
        unblocked_jobs: t.json<DbJob[]>(),
        blocker_trace_contexts: t.json<(string | null)[]>(),
      },
    },
  );

  const getJobChainByIdSql = sql(
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
    {
      id: "getJobChainById",
      params: [id],
      columns: rowToJsonJobColumns,
      readOnly: true,
    },
  );

  const getJobBlockersSql = sql(
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
    {
      id: "getJobBlockers",
      params: [id],
      columns: rowToJsonJobColumns,
      readOnly: true,
    },
  );

  const getJobByIdSql = sql(
    /* sql */ `
SELECT *
FROM {{schema}}.{{table_prefix}}job
WHERE id = $1
`,
    {
      id: "getJobById",
      params: [id],
      columns: { ...dbJobColumns },
      readOnly: true,
    },
  );

  const rescheduleJobSql = sql(
    /* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET scheduled_at = COALESCE($2::timestamptz, now() + ($3::bigint || ' milliseconds')::interval, now()),
  last_attempt_at = now(),
  last_attempt_error = $4::jsonb,
  leased_by = NULL,
  leased_until = NULL,
  status = 'pending'
WHERE id = $1
RETURNING *
`,
    {
      id: "rescheduleJob",
      params: [id, t["date?"](), t["number?"](), t.string()],
      columns: { ...dbJobColumns },
    },
  );

  const triggerJobsSql = sql(
    /* sql */ `
WITH _existing AS (
  -- Lock rows in id order so concurrent triggerJobs calls on overlapping
  -- id sets acquire locks consistently and don't deadlock. FOR UPDATE
  -- also makes classification observe the latest committed version, so
  -- the UPDATE below sees the same status we classified against.
  SELECT id, status FROM {{schema}}.{{table_prefix}}job
  WHERE id = ANY($1::{{id_type}}[])
  ORDER BY id
  FOR UPDATE
),
_not_found AS (
  SELECT DISTINCT i AS id
  FROM unnest($1::{{id_type}}[]) AS i
  WHERE NOT EXISTS (SELECT 1 FROM _existing e WHERE e.id = i)
),
_not_triggerable AS (
  SELECT id, status FROM _existing WHERE status != 'pending'
),
_updated AS (
  -- All-or-nothing: only update when every input id resolves to a pending
  -- job. If anything is missing or non-pending, no rows are touched.
  UPDATE {{schema}}.{{table_prefix}}job
  SET scheduled_at = now()
  WHERE id IN (SELECT id FROM _existing WHERE status = 'pending')
    AND NOT EXISTS (SELECT 1 FROM _not_found)
    AND NOT EXISTS (SELECT 1 FROM _not_triggerable)
  RETURNING *
)
SELECT
  COALESCE((SELECT json_agg(row_to_json(u)) FROM _updated u), '[]'::json) AS triggered,
  COALESCE((SELECT json_agg(id) FROM _not_found), '[]'::json) AS not_found,
  COALESCE(
    (SELECT json_agg(json_build_object('id', id, 'status', status)) FROM _not_triggerable),
    '[]'::json
  ) AS not_triggerable
`,
    {
      id: "triggerJobs",
      params: [t.array()],
      columns: {
        triggered: t.json<DbJob[]>(),
        not_found: t.json<string[]>(),
        not_triggerable: t.json<{ id: string; status: string }[]>(),
      },
    },
  );

  const renewJobLeaseSql = sql(
    /* sql */ `
UPDATE {{schema}}.{{table_prefix}}job
SET leased_by = $2,
  leased_until = now() + ($3::bigint || ' milliseconds')::interval,
  status = 'running'
WHERE id = $1
RETURNING *
`,
    {
      id: "renewJobLease",
      params: [id, t.string(), t.number()],
      columns: { ...dbJobColumns },
    },
  );

  const acquireJobSql = sql(
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
    {
      id: "acquireJob",
      params: [t.array()],
      columns: { ...dbJobColumns, has_more: t.boolean() },
    },
  );

  const getNextJobAvailableInMsSql = sql(
    /* sql */ `
SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (job.scheduled_at - now())) * 1000))::integer AS available_in_ms
FROM {{schema}}.{{table_prefix}}job as job
WHERE job.type_name IN (SELECT unnest($1::text[]))
  AND job.status = 'pending'
ORDER BY job.scheduled_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
`,
    {
      id: "getNextJobAvailableInMs",
      params: [t.array()],
      columns: { available_in_ms: t.number() },
    },
  );

  const reapExpiredJobLeaseSql = sql(
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
    {
      id: "reapExpiredJobLease",
      params: [t.array(), t.array()],
      columns: { ...dbJobColumns },
    },
  );

  const getConnectedChainIdsSql = sql(
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
    {
      id: "getConnectedChainIds",
      params: [t.array()],
      columns: { chain_id: id },
      readOnly: true,
    },
  );

  const deleteJobChainsSql = sql(
    /* sql */ `
WITH _locked AS (
  -- Lock all jobs in chains being deleted before checking external refs, so
  -- the check and DELETE see the same state even under concurrency.
  SELECT id FROM {{schema}}.{{table_prefix}}job
  WHERE chain_id = ANY($1::{{id_type}}[])
  ORDER BY ctid
  FOR UPDATE
),
_external_refs AS (
  SELECT jb.job_id, jb.blocked_by_chain_id
  FROM {{schema}}.{{table_prefix}}job_blocker jb
  JOIN {{schema}}.{{table_prefix}}job j ON j.id = jb.job_id
  WHERE jb.blocked_by_chain_id = ANY($1::{{id_type}}[])
    AND j.chain_id != ALL($1::{{id_type}}[])
),
_deleted_blockers AS (
  DELETE FROM {{schema}}.{{table_prefix}}job_blocker
  WHERE job_id IN (SELECT id FROM _locked)
    AND NOT EXISTS (SELECT 1 FROM _external_refs)
),
_deleted_jobs AS (
  DELETE FROM {{schema}}.{{table_prefix}}job
  WHERE id IN (SELECT id FROM _locked)
    AND NOT EXISTS (SELECT 1 FROM _external_refs)
  RETURNING *
),
_deleted_pairs AS (
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
)
SELECT
  COALESCE((SELECT json_agg(row_to_json(p)) FROM _deleted_pairs p), '[]'::json) AS deleted,
  COALESCE((SELECT json_agg(row_to_json(r)) FROM _external_refs r), '[]'::json) AS blocker_refs
`,
    {
      id: "deleteJobChains",
      params: [t.array()],
      columns: {
        deleted: t.json<{ root_job: DbJob; last_chain_job: DbJob | null }[]>(),
        blocker_refs: t.json<{ job_id: string; blocked_by_chain_id: string }[]>(),
      },
    },
  );

  const getJobForUpdateSql = sql(
    /* sql */ `
SELECT *
FROM {{schema}}.{{table_prefix}}job
WHERE id = $1
FOR UPDATE
`,
    {
      id: "getJobForUpdate",
      params: [id],
      columns: { ...dbJobColumns },
    },
  );

  const getLatestChainJobForUpdateSql = sql(
    /* sql */ `
SELECT *
FROM {{schema}}.{{table_prefix}}job
WHERE chain_id = $1
ORDER BY chain_index DESC
LIMIT 1
FOR UPDATE
`,
    {
      id: "getLatestChainJobForUpdate",
      params: [id],
      columns: { ...dbJobColumns },
    },
  );

  return {
    dbJobColumns,
    rowToJsonJobColumns,
    createMigrationTableSql,
    getAppliedMigrationsSql,
    recordMigrationSql,
    createJobsSql,
    addJobsBlockersSql,
    completeJobSql,
    unblockJobsSql,
    getJobChainByIdSql,
    getJobBlockersSql,
    getJobByIdSql,
    rescheduleJobSql,
    triggerJobsSql,
    renewJobLeaseSql,
    acquireJobSql,
    getNextJobAvailableInMsSql,
    reapExpiredJobLeaseSql,
    getConnectedChainIdsSql,
    deleteJobChainsSql,
    getJobForUpdateSql,
    getLatestChainJobForUpdateSql,
  } as const;
};
