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

/** @internal */
export const createLegacyUpgrade = <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
  idDataType: IdDataType,
): { renameLegacySchemaAside: MigrationScript; importLegacySchema: MigrationScript } => {
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

  const renameLockTimeoutMs = 5000;

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

  const jobOldPresentSql = relationPresentSql("job_old");
  const jobPresentSql = relationPresentSql("job");

  // The columns the import reads, plus the absence of one the current schema added. Probed through
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
  // indexes the install would silently skip on a name clash, or columns the import does not copy.
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

  const statement = (text: string) => applyTemplate(sql(text, { params: [], columns: {} }));

  const renameTablesAsideStatements = [
    // A running worker holds locks on the job tables; fail fast instead of queueing every
    // other statement behind this ACCESS EXCLUSIVE request.
    `SET LOCAL lock_timeout = '${renameLockTimeoutMs}ms'`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job RENAME TO {{table_prefix}}job_old`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_blocker RENAME TO {{table_prefix}}job_blocker_old`,
  ].map(statement);

  // A primary key's index name is schema-wide and equals the one the install gives the new table,
  // so it has to move. Postgres generated it, truncating long names to 63 bytes, so it is read
  // from the catalog rather than rebuilt from the prefix. Foreign keys need no renaming: their
  // names are per table and the new schema declares none.
  const renamedAsidePrimaryKeysSql = applyTemplate(
    sql(
      /* sql */ `SELECT conname, conrelid = to_regclass('{{schema}}.{{table_prefix}}job_old') AS is_job
FROM pg_catalog.pg_constraint
WHERE contype = 'p'
  AND conrelid IN (
    to_regclass('{{schema}}.{{table_prefix}}job_old'),
    to_regclass('{{schema}}.{{table_prefix}}job_blocker_old'))`,
      {
        id: "legacy:renamed-aside-primary-keys",
        params: [],
        columns: { conname: t.string(), is_job: t.boolean() },
        readOnly: true,
      },
    ),
  );

  const renamePrimaryKeyAsideStatement = (conname: string, isJob: boolean) => {
    const table = isJob ? "job_old" : "job_blocker_old";
    return statement(
      /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}${table} RENAME CONSTRAINT "${conname.replaceAll('"', '""')}" TO {{table_prefix}}${table}_pkey`,
    );
  };

  const prepareImportStatements = [
    /* sql */ `ALTER INDEX {{schema}}.{{table_prefix}}chain_index_idx RENAME TO {{table_prefix}}job_old_chain_index_idx`,
    /* sql */ `DROP INDEX {{schema}}.{{table_prefix}}job_deduplication_idx`,
    /* sql */ `DROP INDEX {{schema}}.{{table_prefix}}job_blocker_chain_idx`,
    /* sql */ `DELETE FROM {{schema}}.{{table_prefix}}migration WHERE name IN (${legacyMigrationNames
      .map((name) => `'${name}'`)
      .join(", ")})`,
  ].map(statement);

  // Batches are picked by anti-join against the destination rather than by an id watermark
  // read back from it: once 001_initial_schema is recorded, rows created through the new
  // schema can land in job with ids above every legacy one and would hide the rest.
  const notImportedChains = /* sql */ `SELECT o.id FROM {{schema}}.{{table_prefix}}job_old o
WHERE o.chain_index = 0
  AND NOT EXISTS (SELECT 1 FROM {{schema}}.{{table_prefix}}job j WHERE j.id = o.id)`;

  const firstChainBatchSql = applyTemplate(
    sql(`${notImportedChains}\nORDER BY o.id LIMIT $1`, {
      id: "legacy:chains:first",
      params: [t.number()],
      columns: { id: idDataType },
      readOnly: true,
    }),
  );

  const nextChainBatchSql = applyTemplate(
    sql(`${notImportedChains}\n  AND o.id > $1\nORDER BY o.id LIMIT $2`, {
      id: "legacy:chains:next",
      params: [idDataType, t.number()],
      columns: { id: idDataType },
      readOnly: true,
    }),
  );

  // The engine may already be completing chains imported by an earlier batch (a resumed upgrade),
  // and completing one unblocks only the dependents whose blocker rows it can see. Locking those
  // heads first either lets such a completion commit before the batch reads its chain status
  // below, or makes it wait until the batch's blocker rows are visible to its unblock.
  const lockImportedBlockerHeadsSql = applyTemplate(
    sql(
      /* sql */ `SELECT h.id FROM {{schema}}.{{table_prefix}}job h
WHERE h.id IN (
  SELECT b.blocked_by_chain_id FROM {{schema}}.{{table_prefix}}job_blocker_old b
  JOIN {{schema}}.{{table_prefix}}job_old o ON o.id = b.job_id
  WHERE o.chain_id = ANY($1::{{id_type}}[]))
ORDER BY h.id
FOR UPDATE`,
      { id: "legacy:blockers:lock-heads", params: [t.array()], columns: { id: idDataType } },
    ),
  );

  // A blocked job is re-evaluated against its blockers' current state, and unblocked the way the
  // engine would: an already-imported blocker chain counts by its head in the new table (the engine
  // may have completed it since), any other by its tail in the old one. v0.15.1 recorded no attempt
  // start time, so a running job's attempt starts at the upgrade; a job that is not running holds no
  // attempt, whatever lease it last carried.
  const importChainsSql = applyTemplate(
    sql(
      /* sql */ `INSERT INTO {{schema}}.{{table_prefix}}job (
  id, type_name, chain_id, chain_index, continued_to_id,
  input, output, status,
  created_at, scheduled_at, completed_at, completed_by,
  attempt, last_attempt_at, last_attempt_error,
  attempt_at, attempt_by, attempt_until,
  chain_status, chain_completed_at, chain_deduplication_key, chain_trace_context, trace_context)
SELECT o.id, o.type_name, o.chain_id, o.chain_index, n.id,
  o.input, o.output,
  CASE WHEN u.unblocked THEN 'pending' ELSE o.status::text END,
  o.created_at,
  CASE WHEN u.unblocked THEN GREATEST(o.scheduled_at, now()) ELSE o.scheduled_at END,
  o.completed_at, o.completed_by,
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
FROM {{schema}}.{{table_prefix}}job_old o
LEFT JOIN {{schema}}.{{table_prefix}}job_old n
  ON n.chain_id = o.chain_id AND n.chain_index = o.chain_index + 1
CROSS JOIN LATERAL (
  SELECT o.status = 'blocked'
    AND EXISTS (SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker_old b WHERE b.job_id = o.id)
    AND NOT EXISTS (
      SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker_old b
      LEFT JOIN {{schema}}.{{table_prefix}}job h ON h.id = b.blocked_by_chain_id
      WHERE b.job_id = o.id
        AND CASE WHEN h.id IS NOT NULL THEN h.chain_status IS DISTINCT FROM 'completed'
          ELSE NOT EXISTS (
            SELECT 1 FROM {{schema}}.{{table_prefix}}job_old t
            WHERE t.chain_id = b.blocked_by_chain_id AND t.completed_at IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM {{schema}}.{{table_prefix}}job_old tn
                WHERE tn.chain_id = t.chain_id AND tn.chain_index = t.chain_index + 1))
        END) AS unblocked
) u
WHERE o.chain_id = ANY($1::{{id_type}}[])`,
      { id: "legacy:jobs:import", params: [t.array()], columns: {} },
    ),
  );

  // Blocker rows travel with their blocked job's chain, in the same transaction: a blocker chain
  // imported and completed while the dependent's rows were still pending import would have nothing
  // to unblock, and the rows imported afterwards would never be re-evaluated.
  const importBlockersSql = applyTemplate(
    sql(
      /* sql */ `INSERT INTO {{schema}}.{{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT b.job_id, b.blocked_by_chain_id, b."index", b.trace_context
FROM {{schema}}.{{table_prefix}}job_blocker_old b
JOIN {{schema}}.{{table_prefix}}job_old o ON o.id = b.job_id
WHERE o.chain_id = ANY($1::{{id_type}}[])`,
      { id: "legacy:blockers:import", params: [t.array()], columns: {} },
    ),
  );

  const missingCountsSql = applyTemplate(
    sql(
      /* sql */ `SELECT
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_old o
    WHERE NOT EXISTS (SELECT 1 FROM {{schema}}.{{table_prefix}}job j WHERE j.id = o.id)) AS missing_jobs,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_old) AS old_jobs,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_blocker_old o
    WHERE NOT EXISTS (
      SELECT 1 FROM {{schema}}.{{table_prefix}}job_blocker b
      WHERE b.job_id = o.job_id AND b.blocked_by_chain_id = o.blocked_by_chain_id AND b."index" = o."index"
    )) AS missing_blockers,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_blocker_old) AS old_blockers`,
      {
        id: "legacy:missing",
        params: [],
        columns: {
          missing_jobs: t.string(),
          old_jobs: t.string(),
          missing_blockers: t.string(),
          old_blockers: t.string(),
        },
        readOnly: true,
      },
    ),
  );

  const missingJobsQuery = applyTemplate(
    sql(
      /* sql */ `SELECT * FROM {{schema}}.{{table_prefix}}job_old o WHERE NOT EXISTS (SELECT 1 FROM {{schema}}.{{table_prefix}}job j WHERE j.id = o.id)`,
      { params: [], columns: {} },
    ),
  ).sql;
  const oldBlockerTable = applyTemplate(
    sql(/* sql */ `{{schema}}.{{table_prefix}}job_blocker_old`, { params: [], columns: {} }),
  ).sql;

  const dropOldStatements = [
    /* sql */ `DROP TABLE {{schema}}.{{table_prefix}}job_blocker_old`,
    /* sql */ `DROP TABLE {{schema}}.{{table_prefix}}job_old`,
    /* sql */ `DROP TYPE IF EXISTS {{schema}}.{{table_prefix}}job_status`,
  ].map(statement);

  const isLockTimeout = (error: unknown): boolean => {
    for (let current = error; current instanceof Error; current = current.cause) {
      if ((current as Error & { code?: unknown }).code === "55P03") return true;
    }
    return false;
  };

  const renameLegacySchemaAside: MigrationScript = async () => {
    const [old] = await exec({ sql: jobOldPresentSql });
    if (old?.present) return;
    const [job] = await exec({ sql: jobPresentSql });
    if (!job?.present) return;

    const [legacyShape] = await exec({ sql: legacyShapeSql });
    const [floor] = await exec({ sql: upgradeFloorAppliedSql });
    if (!legacyShape?.present) {
      if (!floor?.present) return;
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

    try {
      await stateProvider.withTransaction(async (txCtx) => {
        for (const renameAside of renameTablesAsideStatements) {
          await exec({ txCtx, sql: renameAside });
        }
        for (const { conname, is_job } of await exec({ txCtx, sql: renamedAsidePrimaryKeysSql })) {
          await exec({ txCtx, sql: renamePrimaryKeyAsideStatement(conname, is_job) });
        }
        for (const prepareImport of prepareImportStatements) {
          await exec({ txCtx, sql: prepareImport });
        }
      });
    } catch (error) {
      if (!isLockTimeout(error)) throw error;
      throw new Error(
        `Cannot upgrade: the queuert job tables stayed locked for ${renameLockTimeoutMs}ms. The upgrade replaces these tables, so stop all workers and clients using them, then run migrateToLatest() again.`,
        { cause: error },
      );
    }
  };

  const importLegacySchema: MigrationScript = async (assertLockHeld) => {
    const [old] = await exec({ sql: jobOldPresentSql });
    if (!old?.present) return;

    let afterChainId: string | undefined;
    for (;;) {
      assertLockHeld();
      const batch = afterChainId
        ? await exec({ sql: nextChainBatchSql, params: [afterChainId, batchSize] })
        : await exec({ sql: firstChainBatchSql, params: [batchSize] });
      if (batch.length === 0) break;
      const chainIds = batch.map((row) => row.id);
      await stateProvider.withTransaction(async (txCtx) => {
        await exec({ txCtx, sql: lockImportedBlockerHeadsSql, params: [chainIds] });
        await exec({ txCtx, sql: importChainsSql, params: [chainIds] });
        await exec({ txCtx, sql: importBlockersSql, params: [chainIds] });
      });
      afterChainId = chainIds[chainIds.length - 1];
    }

    const [missing] = await exec({ sql: missingCountsSql });
    if (missing.missing_jobs !== "0" || missing.missing_blockers !== "0") {
      throw new Error(
        `Upgrade import is incomplete: ${missing.missing_jobs}/${missing.old_jobs} jobs and ${missing.missing_blockers}/${missing.old_blockers} blockers are missing from the new tables. The renamed-aside tables were left in place. Jobs are imported with their chain's head job, so a job left behind is one whose chain has no head row; list them with \`${missingJobsQuery}\`, then delete them and their ${oldBlockerTable} rows (or restore their head jobs) and run migrateToLatest() again.`,
      );
    }

    await stateProvider.withTransaction(async (txCtx) => {
      for (const dropOld of dropOldStatements) {
        await exec({ txCtx, sql: dropOld });
      }
    });
  };

  return { renameLegacySchemaAside, importLegacySchema };
};
