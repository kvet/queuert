import {
  type DataType,
  type InferColumns,
  type InferParams,
  type MigrationScript,
  type TemplateApplier,
  type TypedSql,
  extractColumnTypes,
  extractParamTypes,
  sql,
  t,
} from "@queuert/typed-sql";
import { type BaseTxContext } from "queuert";

import { type PgStateProvider } from "../state-provider/state-provider.pg.js";

type IdDataType = DataType<"uuid" | "string", string>;

// Postgres' makeObjectName: the name it generates for an unnamed constraint, truncating the longer
// of the table and column names until the whole fits in NAMEDATALEN - 1 bytes. Identifiers are
// validated to ASCII, so characters are bytes.
const generatedConstraintName = (table: string, column: string | undefined, label: string) => {
  const available = 63 - (label.length + 1) - (column === undefined ? 0 : 1);
  let tableChars = table.length;
  let columnChars = column?.length ?? 0;
  while (tableChars + columnChars > available) {
    if (tableChars > columnChars) tableChars--;
    else columnChars--;
  }
  return [table.slice(0, tableChars), column?.slice(0, columnChars), label]
    .filter((part) => part !== undefined)
    .join("_");
};

const constraintLabels: Record<string, string> = { p: "pkey", c: "check", n: "not_null" };

/**
 * Upgrades a live v0.15.1 schema without stopping its workers for the copy.
 *
 * The current tables are built beside the v0.15.1 ones (`job_new`, `job_blocker_new`), and triggers
 * on the v0.15.1 tables record every chain a v0.15.1 process changes from then on. Chains are copied
 * across in batches while the v0.15.1 engine keeps running; the changed chains are then copied again
 * until few remain. Only the final step, which copies the last changed chains and swaps the tables,
 * holds the v0.15.1 tables exclusively.
 *
 * @internal
 */
export const createLegacyUpgrade = <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
  idDataType: IdDataType,
): { prepare: MigrationScript; upgrade: MigrationScript } => {
  const legacyMigrationNames = [
    "20240101000000_initial_schema",
    "20240102000000_vacuum_tuning",
    "20260430000000_rename_chain_indexes",
    "20260517000000_drop_job_id_default",
    "20260531000000_vacuum_threshold_pinning",
    "20260617000000_blocker_composite_pk",
  ];

  const upgradeFloor = legacyMigrationNames[legacyMigrationNames.length - 1];

  const batchSize = 1000;

  const lockTimeoutMs = 5000;

  const exec = async <
    TParams extends readonly DataType[],
    TColumns extends Record<string, DataType>,
  >({
    txCtx,
    sql: typedSql,
    params,
  }: {
    txCtx?: TTxContext;
    sql: TypedSql<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): Promise<InferColumns<TColumns>[]> =>
    stateProvider.executeSql({
      txCtx,
      id: typedSql.id,
      sql: typedSql.sql,
      params: params ?? [],
      paramTypes: extractParamTypes(typedSql.params),
      columnTypes: extractColumnTypes(typedSql.columns),
      readOnly: typedSql.readOnly,
    }) as Promise<InferColumns<TColumns>[]>;

  const statement = (text: string) => applyTemplate(sql(text, { params: [], columns: {} }));

  const relationPresentSql = (relation: string) =>
    applyTemplate(
      sql(
        /* sql */ `SELECT to_regclass('{{schema}}.{{table_prefix}}${relation}') IS NOT NULL AS present`,
        {
          id: `legacy:present:${relation}`,
          params: [],
          columns: { present: t.boolean() },
          readOnly: true,
        },
      ),
    );

  const jobPresentSql = relationPresentSql("job");
  const jobNewPresentSql = relationPresentSql("job_new");

  // The columns the copy reads, plus the absence of one the current schema added. Probed through
  // the catalog by OID rather than by comparing names as strings: to_regclass folds the unquoted
  // prefix exactly as the DDL that created the table did, so a mixed-case prefix still matches.
  const legacyColumns = [
    "chain_type_name",
    "status",
    "leased_by",
    "leased_until",
    "deduplication_key",
    "chain_trace_context",
  ];
  const legacyShapeSql = applyTemplate(
    sql(
      /* sql */ `SELECT (
  (SELECT count(*) FROM pg_catalog.pg_attribute
    WHERE attrelid = to_regclass('{{schema}}.{{table_prefix}}job')::oid
      AND attname IN (${legacyColumns.map((name) => `'${name}'`).join(", ")})
      AND NOT attisdropped) = ${legacyColumns.length}
  AND NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = to_regclass('{{schema}}.{{table_prefix}}job')::oid
      AND attname = 'continued_to_id'
      AND NOT attisdropped)
) AS present`,
      {
        id: "legacy:present:shape",
        params: [],
        columns: { present: t.boolean() },
        readOnly: true,
      },
    ),
  );

  const upgradeFloorAppliedSql = applyTemplate(
    sql(
      /* sql */ `SELECT EXISTS(
  SELECT 1 FROM {{schema}}.{{table_prefix}}migration WHERE name = '${upgradeFloor}'
) AS present`,
      {
        id: "legacy:present:floor",
        params: [],
        columns: { present: t.boolean() },
        readOnly: true,
      },
    ),
  );

  // A migration past v0.15.1 (a later maintenance release, or an unreleased build) may have added
  // indexes or columns the copy does not know about.
  const unrecognizedMigrationsSql = applyTemplate(
    sql(
      /* sql */ `SELECT name FROM {{schema}}.{{table_prefix}}migration
WHERE name NOT IN (${legacyMigrationNames.map((name) => `'${name}'`).join(", ")})
ORDER BY name`,
      {
        id: "legacy:unrecognized-migrations",
        params: [],
        columns: { name: t.string() },
        readOnly: true,
      },
    ),
  );

  // The current schema's 001_initial_schema, built beside the v0.15.1 tables under the _new names.
  // Index names are the final ones: they belong to the table and travel with it through the swap.
  const newTables = [
    /* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_new (
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,
  last_attempt_at               timestamptz,
  attempt_at                    timestamptz,
  attempt_until                 timestamptz,
  chain_completed_at            timestamptz,

  chain_index                   integer NOT NULL,
  attempt                       integer NOT NULL DEFAULT 0,

  id                            {{id_type}} PRIMARY KEY,
  chain_id                      {{id_type}} NOT NULL,
  continued_to_id               {{id_type}},

  status                        text NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  chain_status                  text
                                CHECK (chain_status IN ('running', 'completed')),
  type_name                     text NOT NULL,
  completed_by                  text,
  attempt_by                    text,
  chain_deduplication_key       text,
  chain_trace_context           text,
  trace_context                 text,
  last_attempt_error            jsonb,
  input                         jsonb,
  output                        jsonb
) WITH (
  fillfactor = 75,
  autovacuum_vacuum_cost_delay = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
)`,
    /* sql */ `
CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}job_blocker_new (
  job_id                        {{id_type}} NOT NULL,
  blocked_by_chain_id           {{id_type}} NOT NULL,
  index                         integer NOT NULL,
  trace_context                 text,
  PRIMARY KEY (job_id, blocked_by_chain_id, "index")
) WITH (
  autovacuum_vacuum_cost_delay = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
)`,
  ];

  const newChainIndex = /* sql */ `
CREATE UNIQUE INDEX IF NOT EXISTS {{table_prefix}}chain_index_idx
ON {{schema}}.{{table_prefix}}job_new (chain_id, chain_index)
WHERE chain_index > 0`;

  const newIndexes = [
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_deduplication_idx
ON {{schema}}.{{table_prefix}}job_new (chain_deduplication_key, created_at DESC)
WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_idx
ON {{schema}}.{{table_prefix}}job_new (type_name, created_at)`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_pending_idx
ON {{schema}}.{{table_prefix}}job_new (type_name, scheduled_at)
WHERE status = 'pending'`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocked_idx
ON {{schema}}.{{table_prefix}}job_new (type_name, scheduled_at)
WHERE status = 'blocked'`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_running_idx
ON {{schema}}.{{table_prefix}}job_new (type_name, attempt_until)
WHERE status = 'running'`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_completed_idx
ON {{schema}}.{{table_prefix}}job_new (type_name, completed_at)
WHERE status = 'completed'`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_idx
ON {{schema}}.{{table_prefix}}job_new (type_name, created_at)
WHERE chain_index = 0`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_running_idx
ON {{schema}}.{{table_prefix}}job_new (type_name, created_at)
WHERE chain_index = 0 AND chain_status = 'running'`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}chain_completed_idx
ON {{schema}}.{{table_prefix}}job_new (type_name, chain_completed_at)
WHERE chain_index = 0 AND chain_status = 'completed'`,
    /* sql */ `
CREATE INDEX IF NOT EXISTS {{table_prefix}}job_blocker_chain_idx
ON {{schema}}.{{table_prefix}}job_blocker_new (blocked_by_chain_id)`,
  ].map(statement);

  // A v0.15.1 process holds row locks on the chain it changes until it commits, and the upsert
  // below takes the changed-chain row's lock too, even when the row already exists. A copy that
  // claims the row therefore either skips it (SKIP LOCKED) or waits for that commit, so it never
  // copies a chain whose change is still in flight and then forgets it.
  const markChanged = (chainId: string) => /* sql */ `
    INSERT INTO {{schema}}.{{table_prefix}}upgrade_changed_chain (chain_id) ${chainId}
    ON CONFLICT (chain_id) DO UPDATE SET changed_at = now();`;

  // Built in a single transaction: the triggers must be in place before the first chain is copied,
  // and the presence of job_new is what marks the setup as done. Every statement tolerates a
  // previous setup, so dropping job_new and job_blocker_new (as a diverged copy directs) restarts
  // the copy while the tracking objects stay in place.
  const setupStatements = [
    `SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`,
    // The two v0.15.1 indexes whose names the current schema reuses. v0.15.1 never refers to its
    // indexes by name at runtime, and they are dropped with their tables. After a previous setup the
    // names belong to job_new's indexes, gone with it.
    /* sql */ `ALTER INDEX IF EXISTS {{schema}}.{{table_prefix}}chain_index_idx RENAME TO {{table_prefix}}job_old_chain_index_idx`,
    /* sql */ `ALTER INDEX IF EXISTS {{schema}}.{{table_prefix}}job_blocker_chain_idx RENAME TO {{table_prefix}}job_blocker_old_chain_idx`,
    ...newTables,
    // The one index the copy needs from the start: with it, a chain's rows in job_new are found by
    // index rather than by scanning everything copied so far.
    newChainIndex,
    /* sql */ `CREATE TABLE IF NOT EXISTS {{schema}}.{{table_prefix}}upgrade_changed_chain (
  chain_id {{id_type}} PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now()
)`,
    // One function for both tables, told which by its trigger argument: a long prefix would
    // truncate two function names to the same identifier.
    /* sql */ `CREATE OR REPLACE FUNCTION {{schema}}.{{table_prefix}}upgrade_track() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_ARGV[0] = 'job' THEN
    IF TG_OP <> 'INSERT' THEN${markChanged("VALUES (OLD.chain_id)")}
    END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.chain_id IS DISTINCT FROM OLD.chain_id) THEN${markChanged("VALUES (NEW.chain_id)")}
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN${markChanged("SELECT chain_id FROM {{schema}}.{{table_prefix}}job WHERE id = OLD.job_id")}
    END IF;
    IF TG_OP <> 'DELETE' THEN${markChanged("SELECT chain_id FROM {{schema}}.{{table_prefix}}job WHERE id = NEW.job_id")}
    END IF;
  END IF;
  RETURN NULL;
END $$`,
    /* sql */ `CREATE OR REPLACE TRIGGER {{table_prefix}}upgrade_track
AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.{{table_prefix}}job
FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{table_prefix}}upgrade_track('job')`,
    /* sql */ `CREATE OR REPLACE TRIGGER {{table_prefix}}upgrade_track
AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.{{table_prefix}}job_blocker
FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{table_prefix}}upgrade_track('job_blocker')`,
  ].map(statement);

  // Batches are picked by anti-join against job_new, so a resumed copy skips what an earlier run
  // (or a changed-chain pass) already copied.
  const notCopiedChains = /* sql */ `SELECT o.id FROM {{schema}}.{{table_prefix}}job o
WHERE o.chain_index = 0
  AND NOT EXISTS (SELECT 1 FROM {{schema}}.{{table_prefix}}job_new j WHERE j.id = o.id)`;

  const firstChainBatchSql = applyTemplate(
    sql(`${notCopiedChains}\nORDER BY o.id LIMIT $1`, {
      id: "legacy:chains:first",
      params: [t.number()],
      columns: { id: idDataType },
      readOnly: true,
    }),
  );

  const nextChainBatchSql = applyTemplate(
    sql(`${notCopiedChains}\n  AND o.id > $1\nORDER BY o.id LIMIT $2`, {
      id: "legacy:chains:next",
      params: [idDataType, t.number()],
      columns: { id: idDataType },
      readOnly: true,
    }),
  );

  const claimChangedChainsSql = applyTemplate(
    sql(
      /* sql */ `DELETE FROM {{schema}}.{{table_prefix}}upgrade_changed_chain
WHERE chain_id IN (
  SELECT chain_id FROM {{schema}}.{{table_prefix}}upgrade_changed_chain
  ORDER BY chain_id LIMIT $1
  FOR UPDATE SKIP LOCKED)
RETURNING chain_id`,
      {
        id: "legacy:changed:claim",
        params: [t.number()],
        columns: { chain_id: idDataType },
      },
    ),
  );

  // A chain's rows in job_new: its head, whose id is the chain id, and its continuations. Spelled
  // out so each half matches an index (the primary key, and the partial chain_index_idx) instead
  // of scanning job_new.
  const copiedChainRows = (alias: string) =>
    `((${alias}.id = ANY($1::{{id_type}}[]) AND ${alias}.chain_index = 0) OR (${alias}.chain_id = ANY($1::{{id_type}}[]) AND ${alias}.chain_index > 0))`;

  // A copy replaces the chain wholesale, so copying a chain again (or copying one the v0.15.1
  // engine has since deleted) leaves job_new matching the v0.15.1 tables.
  const removeCopiedBlockersSql = applyTemplate(
    sql(
      /* sql */ `DELETE FROM {{schema}}.{{table_prefix}}job_blocker_new
WHERE job_id IN (
  SELECT n.id FROM {{schema}}.{{table_prefix}}job_new n WHERE ${copiedChainRows("n")})`,
      { id: "legacy:blockers:remove", params: [t.array()], columns: {} },
    ),
  );

  const removeCopiedJobsSql = applyTemplate(
    sql(
      /* sql */ `DELETE FROM {{schema}}.{{table_prefix}}job_new n WHERE ${copiedChainRows("n")}`,
      { id: "legacy:jobs:remove", params: [t.array()], columns: {} },
    ),
  );

  // The v0.15.1 engine stays in charge until the swap, unblocking jobs as it completes chains, so
  // rows are copied as they are. v0.15.1 recorded no attempt start time, so a running job's attempt
  // starts when it is copied; a job that is not running holds no attempt, whatever lease it last
  // carried. A chain without a head is left behind, and the swap refuses to drop its rows.
  const copyJobsSql = applyTemplate(
    sql(
      /* sql */ `INSERT INTO {{schema}}.{{table_prefix}}job_new (
  id, type_name, chain_id, chain_index, continued_to_id,
  input, output, status,
  created_at, scheduled_at, completed_at, completed_by,
  attempt, last_attempt_at, last_attempt_error,
  attempt_at, attempt_by, attempt_until,
  chain_status, chain_completed_at, chain_deduplication_key, chain_trace_context, trace_context)
SELECT o.id, o.type_name, o.chain_id, o.chain_index, n.id,
  o.input, o.output, o.status::text,
  o.created_at, o.scheduled_at, o.completed_at, o.completed_by,
  o.attempt, o.last_attempt_at, o.last_attempt_error,
  CASE WHEN o.status = 'running' THEN now() END,
  CASE WHEN o.status = 'running' THEN COALESCE(o.leased_by, 'migrated') END,
  CASE WHEN o.status = 'running' THEN COALESCE(o.leased_until, now()) END,
  CASE WHEN o.chain_index = 0
    THEN CASE WHEN max(o.completed_at) FILTER (WHERE n.id IS NULL) OVER (PARTITION BY o.chain_id) IS NULL
      THEN 'running' ELSE 'completed' END END,
  CASE WHEN o.chain_index = 0
    THEN max(o.completed_at) FILTER (WHERE n.id IS NULL) OVER (PARTITION BY o.chain_id) END,
  CASE WHEN o.chain_index = 0 THEN o.deduplication_key END,
  CASE WHEN o.chain_index = 0 THEN o.chain_trace_context END,
  o.trace_context
FROM {{schema}}.{{table_prefix}}job o
LEFT JOIN {{schema}}.{{table_prefix}}job n
  ON n.chain_id = o.chain_id AND n.chain_index = o.chain_index + 1
WHERE o.chain_id = ANY($1::{{id_type}}[])
  AND EXISTS (
    SELECT 1 FROM {{schema}}.{{table_prefix}}job h WHERE h.id = o.chain_id AND h.chain_index = 0)`,
      { id: "legacy:jobs:copy", params: [t.array()], columns: {} },
    ),
  );

  const copyBlockersSql = applyTemplate(
    sql(
      /* sql */ `INSERT INTO {{schema}}.{{table_prefix}}job_blocker_new (job_id, blocked_by_chain_id, "index", trace_context)
SELECT b.job_id, b.blocked_by_chain_id, b."index", b.trace_context
FROM {{schema}}.{{table_prefix}}job_blocker b
JOIN {{schema}}.{{table_prefix}}job_new n ON n.id = b.job_id
WHERE ${copiedChainRows("n")}`,
      { id: "legacy:blockers:copy", params: [t.array()], columns: {} },
    ),
  );

  const lockLegacyTablesStatements = [
    `SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`,
    /* sql */ `LOCK TABLE {{schema}}.{{table_prefix}}job, {{schema}}.{{table_prefix}}job_blocker IN ACCESS EXCLUSIVE MODE`,
  ].map(statement);

  const missingCountsSql = applyTemplate(
    sql(
      /* sql */ `SELECT
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job o
    WHERE NOT EXISTS (SELECT 1 FROM {{schema}}.{{table_prefix}}job_new j WHERE j.id = o.id)) AS missing_jobs,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job) AS old_jobs,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_new) AS new_jobs,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_blocker o
    WHERE NOT EXISTS (
      SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker_new b
      WHERE b.job_id = o.job_id AND b.blocked_by_chain_id = o.blocked_by_chain_id AND b."index" = o."index"
    )) AS missing_blockers,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_blocker) AS old_blockers,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_blocker_new) AS new_blockers`,
      {
        id: "legacy:missing",
        params: [],
        columns: {
          missing_jobs: t.string(),
          old_jobs: t.string(),
          new_jobs: t.string(),
          missing_blockers: t.string(),
          old_blockers: t.string(),
          new_blockers: t.string(),
        },
        readOnly: true,
      },
    ),
  );

  const missingJobsQuery = statement(
    /* sql */ `SELECT * FROM {{schema}}.{{table_prefix}}job o WHERE NOT EXISTS (SELECT 1 FROM {{schema}}.{{table_prefix}}job_new j WHERE j.id = o.id)`,
  ).sql;
  const legacyBlockerTable = statement(/* sql */ `{{schema}}.{{table_prefix}}job_blocker`).sql;

  const swapStatements = [
    /* sql */ `DROP TABLE {{schema}}.{{table_prefix}}job_blocker`,
    /* sql */ `DROP TABLE {{schema}}.{{table_prefix}}job`,
    /* sql */ `DROP TYPE IF EXISTS {{schema}}.{{table_prefix}}job_status`,
    /* sql */ `DROP TABLE {{schema}}.{{table_prefix}}upgrade_changed_chain`,
    /* sql */ `DROP FUNCTION {{schema}}.{{table_prefix}}upgrade_track()`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_new RENAME TO {{table_prefix}}job`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_blocker_new RENAME TO {{table_prefix}}job_blocker`,
    /* sql */ `DELETE FROM {{schema}}.{{table_prefix}}migration WHERE name IN (${legacyMigrationNames
      .map((name) => `'${name}'`)
      .join(", ")})`,
  ].map(statement);

  // Constraints Postgres named after job_new keep that name through the table rename; a fresh
  // install names them after job.
  const swappedConstraintsSql = applyTemplate(
    sql(
      /* sql */ `SELECT c.conname, c.contype::text AS contype, r.relname,
  (SELECT a.attname FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS column_name,
  cardinality(c.conkey) AS column_count
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
WHERE c.conrelid IN (
    to_regclass('{{schema}}.{{table_prefix}}job'),
    to_regclass('{{schema}}.{{table_prefix}}job_blocker'))
  AND c.contype IN ('p', 'c', 'n')`,
      {
        id: "legacy:swapped-constraints",
        params: [],
        columns: {
          conname: t.string(),
          contype: t.string(),
          relname: t.string(),
          column_name: t["string?"](),
          column_count: t.number(),
        },
        readOnly: true,
      },
    ),
  );

  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

  const renameConstraintStatement = (table: string, from: string, to: string) =>
    statement(
      /* sql */ `ALTER TABLE {{schema}}.${quote(table)} RENAME CONSTRAINT ${quote(from)} TO ${quote(to)}`,
    );

  const isLockTimeout = (error: unknown): boolean => {
    for (let current = error; current instanceof Error; current = current.cause) {
      if ((current as Error & { code?: unknown }).code === "55P03") return true;
    }
    return false;
  };

  const isLegacySchema = async (): Promise<boolean> => {
    const [job] = await exec({ sql: jobPresentSql });
    if (!job?.present) return false;

    const [legacyShape] = await exec({ sql: legacyShapeSql });
    const [floor] = await exec({ sql: upgradeFloorAppliedSql });
    if (!legacyShape?.present) {
      if (!floor?.present) return false;
      throw new Error(
        `Cannot upgrade: the existing queuert job table is not in the v0.15.1 shape this upgrade reads. Restore a v0.15.1 database, or drop the queuert tables to start fresh.`,
      );
    }
    if (!floor?.present) {
      throw new Error(
        `Cannot upgrade: the existing queuert schema predates v0.15.1 (migration ${upgradeFloor} is not applied). Upgrade to @queuert/postgres 0.15.1 and run migrateToLatest(), then upgrade to this version.`,
      );
    }
    const unrecognized = await exec({ sql: unrecognizedMigrationsSql });
    if (unrecognized.length > 0) {
      throw new Error(
        `Cannot upgrade: the existing queuert schema has migrations this upgrade does not know (${unrecognized.map((row) => row.name).join(", ")}); it upgrades only a v0.15.1 schema. Restore a v0.15.1 database, or drop the queuert tables to start fresh.`,
      );
    }
    return true;
  };

  const copyChains = async (txCtx: TTxContext, chainIds: string[]): Promise<void> => {
    await exec({ txCtx, sql: removeCopiedBlockersSql, params: [chainIds] });
    await exec({ txCtx, sql: removeCopiedJobsSql, params: [chainIds] });
    await exec({ txCtx, sql: copyJobsSql, params: [chainIds] });
    await exec({ txCtx, sql: copyBlockersSql, params: [chainIds] });
  };

  const claimAndCopyChangedChains = async (txCtx: TTxContext): Promise<number> => {
    const claimed = await exec({ txCtx, sql: claimChangedChainsSql, params: [batchSize] });
    if (claimed.length > 0) {
      await copyChains(
        txCtx,
        claimed.map((row) => row.chain_id),
      );
    }
    return claimed.length;
  };

  const prepare: MigrationScript = async (assertLockHeld) => {
    if (!(await isLegacySchema())) return;

    const [jobNew] = await exec({ sql: jobNewPresentSql });
    if (!jobNew?.present) {
      try {
        await stateProvider.withTransaction(async (txCtx) => {
          for (const setup of setupStatements) {
            await exec({ txCtx, sql: setup });
          }
        });
      } catch (error) {
        if (!isLockTimeout(error)) throw error;
        throw new Error(
          `Cannot prepare the upgrade: the queuert job tables stayed locked for ${lockTimeoutMs}ms. Installing the change-tracking triggers needs a brief lock that waits for in-flight transactions; run it again, or end the long-running transaction holding them.`,
          { cause: error },
        );
      }
    }

    let afterChainId: string | undefined;
    for (;;) {
      assertLockHeld();
      const batch = afterChainId
        ? await exec({ sql: nextChainBatchSql, params: [afterChainId, batchSize] })
        : await exec({ sql: firstChainBatchSql, params: [batchSize] });
      if (batch.length === 0) break;
      const chainIds = batch.map((row) => row.id);
      await stateProvider.withTransaction(async (txCtx) => copyChains(txCtx, chainIds));
      afterChainId = chainIds[chainIds.length - 1];
    }

    // Built after the bulk copy, which loads faster without them. Only this process writes to
    // job_new, so a plain build blocks nothing else.
    for (const index of newIndexes) {
      assertLockHeld();
      await exec({ sql: index });
    }

    // Changed chains are copied until a pass finds fewer than a batch, leaving the swap only a
    // short tail to copy while it holds the v0.15.1 tables.
    for (;;) {
      assertLockHeld();
      const copied = await stateProvider.withTransaction(claimAndCopyChangedChains);
      if (copied < batchSize) break;
    }
  };

  const upgrade: MigrationScript = async (assertLockHeld) => {
    await prepare(assertLockHeld);
    const [jobNew] = await exec({ sql: jobNewPresentSql });
    if (!jobNew?.present) return;

    assertLockHeld();
    try {
      await stateProvider.withTransaction(async (txCtx) => {
        for (const lock of lockLegacyTablesStatements) {
          await exec({ txCtx, sql: lock });
        }
        while ((await claimAndCopyChangedChains(txCtx)) > 0) {
          assertLockHeld();
        }

        const [missing] = await exec({ txCtx, sql: missingCountsSql });
        if (missing.missing_jobs !== "0" || missing.missing_blockers !== "0") {
          throw new Error(
            `Upgrade copy is incomplete: ${missing.missing_jobs}/${missing.old_jobs} jobs and ${missing.missing_blockers}/${missing.old_blockers} blockers are missing from the new tables, so the v0.15.1 tables were left in place. Jobs are copied with their chain's head job, so a job left behind is one whose chain has no head row; list them with \`${missingJobsQuery}\`, then delete them and their ${legacyBlockerTable} rows (or restore their head jobs) and run migrateToLatest() again.`,
          );
        }
        if (
          missing.new_jobs !== missing.old_jobs ||
          missing.new_blockers !== missing.old_blockers
        ) {
          throw new Error(
            `Upgrade copy diverged: the new tables hold ${missing.new_jobs} jobs and ${missing.new_blockers} blockers where the v0.15.1 tables hold ${missing.old_jobs} and ${missing.old_blockers}, so the v0.15.1 tables were left in place. Drop the ${statement("{{schema}}.{{table_prefix}}job_new").sql} and ${statement("{{schema}}.{{table_prefix}}job_blocker_new").sql} tables and run migrateToLatest() again.`,
          );
        }

        for (const swap of swapStatements) {
          await exec({ txCtx, sql: swap });
        }
        for (const constraint of await exec({ txCtx, sql: swappedConstraintsSql })) {
          const name = generatedConstraintName(
            constraint.relname,
            constraint.contype === "p" || constraint.column_count !== 1
              ? undefined
              : (constraint.column_name ?? undefined),
            constraintLabels[constraint.contype],
          );
          if (name !== constraint.conname) {
            await exec({
              txCtx,
              sql: renameConstraintStatement(constraint.relname, constraint.conname, name),
            });
          }
        }
      });
    } catch (error) {
      if (!isLockTimeout(error)) throw error;
      throw new Error(
        `Cannot upgrade: the queuert job tables stayed locked for ${lockTimeoutMs}ms. Switching to the new tables needs them to itself for a moment, so stop all workers and clients still using them, then run migrateToLatest() again; the chains copied so far are kept.`,
        { cause: error },
      );
    }
  };

  return { prepare, upgrade };
};
