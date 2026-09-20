import {
  type DataType,
  type InferColumns,
  type InferParams,
  type MigrationScript,
  type TemplateApplier,
  type TypedSqlTemplate,
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

  const relationPresentSql = (relation: string) =>
    sql(
      /* sql */ `SELECT to_regclass('{{schema}}.{{table_prefix}}${relation}') IS NOT NULL AS present`,
      {
        id: `legacy:present:${relation}`,
        params: [],
        columns: { present: t.boolean() },
        readOnly: true,
      },
    );

  const jobOldPresentSql = relationPresentSql("job_old");
  const jobPresentSql = relationPresentSql("job");

  const legacyShapeSql = sql(
    /* sql */ `SELECT EXISTS(
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = '{{schema}}' AND table_name = '{{table_prefix}}job' AND column_name = 'chain_type_name'
) AS present`,
    {
      id: "legacy:present:shape",
      params: [],
      columns: { present: t.boolean() },
      readOnly: true,
    },
  );

  const upgradeFloorAppliedSql = sql(
    /* sql */ `SELECT EXISTS(
  SELECT 1 FROM {{schema}}.{{table_prefix}}migration WHERE name = '${upgradeFloor}'
) AS present`,
    {
      id: "legacy:present:floor",
      params: [],
      columns: { present: t.boolean() },
      readOnly: true,
    },
  );

  const renameAsideStatements = [
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job RENAME TO {{table_prefix}}job_old`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_blocker RENAME TO {{table_prefix}}job_blocker_old`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_old RENAME CONSTRAINT {{table_prefix}}job_pkey TO {{table_prefix}}job_old_pkey`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_old RENAME CONSTRAINT {{table_prefix}}job_chain_id_fkey TO {{table_prefix}}job_old_chain_id_fkey`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_blocker_old RENAME CONSTRAINT {{table_prefix}}job_blocker_pkey TO {{table_prefix}}job_blocker_old_pkey`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_blocker_old RENAME CONSTRAINT {{table_prefix}}job_blocker_job_id_fkey TO {{table_prefix}}job_blocker_old_job_id_fkey`,
    /* sql */ `ALTER TABLE {{schema}}.{{table_prefix}}job_blocker_old RENAME CONSTRAINT {{table_prefix}}job_blocker_blocked_by_chain_id_fkey TO {{table_prefix}}job_blocker_old_blocked_by_chain_id_fkey`,
    /* sql */ `ALTER INDEX {{schema}}.{{table_prefix}}chain_index_idx RENAME TO {{table_prefix}}job_old_chain_index_idx`,
    /* sql */ `DROP INDEX {{schema}}.{{table_prefix}}job_deduplication_idx`,
    /* sql */ `DROP INDEX {{schema}}.{{table_prefix}}job_blocker_chain_idx`,
    /* sql */ `DELETE FROM {{schema}}.{{table_prefix}}migration WHERE name IN (${legacyMigrationNames
      .map((name) => `'${name}'`)
      .join(", ")})`,
  ];

  const firstChainBatchSql = sql(
    /* sql */ `SELECT id FROM {{schema}}.{{table_prefix}}job_old
WHERE chain_index = 0 ORDER BY id LIMIT $1`,
    {
      id: "legacy:chains:first",
      params: [t.number()],
      columns: { id: idDataType },
      readOnly: true,
    },
  );

  const nextChainBatchSql = sql(
    /* sql */ `SELECT id FROM {{schema}}.{{table_prefix}}job_old
WHERE chain_index = 0 AND id > $1 ORDER BY id LIMIT $2`,
    {
      id: "legacy:chains:next",
      params: [idDataType, t.number()],
      columns: { id: idDataType },
      readOnly: true,
    },
  );

  const lastImportedChainSql = sql(
    /* sql */ `SELECT chain_id FROM {{schema}}.{{table_prefix}}job ORDER BY chain_id DESC LIMIT 1`,
    {
      id: "legacy:chains:watermark",
      params: [],
      columns: { chain_id: idDataType },
      readOnly: true,
    },
  );

  const importChainsSql = sql(
    /* sql */ `INSERT INTO {{schema}}.{{table_prefix}}job (
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
  CASE WHEN o.status = 'running' THEN COALESCE(o.leased_by, 'migrated') ELSE o.leased_by END,
  CASE WHEN o.status = 'running' THEN COALESCE(o.leased_until, now()) ELSE o.leased_until END,
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
WHERE o.chain_id = ANY($1::{{id_type}}[])`,
    { id: "legacy:jobs:import", params: [t.array()], columns: {} },
  );

  const firstBlockerBatchSql = sql(
    /* sql */ `SELECT DISTINCT job_id FROM {{schema}}.{{table_prefix}}job_blocker_old
ORDER BY job_id LIMIT $1`,
    {
      id: "legacy:blockers:first",
      params: [t.number()],
      columns: { job_id: idDataType },
      readOnly: true,
    },
  );

  const nextBlockerBatchSql = sql(
    /* sql */ `SELECT DISTINCT job_id FROM {{schema}}.{{table_prefix}}job_blocker_old
WHERE job_id > $1 ORDER BY job_id LIMIT $2`,
    {
      id: "legacy:blockers:next",
      params: [idDataType, t.number()],
      columns: { job_id: idDataType },
      readOnly: true,
    },
  );

  const lastImportedBlockerSql = sql(
    /* sql */ `SELECT job_id FROM {{schema}}.{{table_prefix}}job_blocker ORDER BY job_id DESC LIMIT 1`,
    {
      id: "legacy:blockers:watermark",
      params: [],
      columns: { job_id: idDataType },
      readOnly: true,
    },
  );

  const importBlockersSql = sql(
    /* sql */ `INSERT INTO {{schema}}.{{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT job_id, blocked_by_chain_id, "index", trace_context
FROM {{schema}}.{{table_prefix}}job_blocker_old
WHERE job_id = ANY($1::{{id_type}}[])`,
    { id: "legacy:blockers:import", params: [t.array()], columns: {} },
  );

  const importedCountsSql = sql(
    /* sql */ `SELECT
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_old) AS old_jobs,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job) AS jobs,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_blocker_old) AS old_blockers,
  (SELECT count(*) FROM {{schema}}.{{table_prefix}}job_blocker) AS blockers`,
    {
      id: "legacy:counts",
      params: [],
      columns: {
        old_jobs: t.string(),
        jobs: t.string(),
        old_blockers: t.string(),
        blockers: t.string(),
      },
      readOnly: true,
    },
  );

  const dropOldStatements = [
    /* sql */ `DROP TABLE {{schema}}.{{table_prefix}}job_blocker_old`,
    /* sql */ `DROP TABLE {{schema}}.{{table_prefix}}job_old`,
    /* sql */ `DROP TYPE IF EXISTS {{schema}}.{{table_prefix}}job_status`,
  ];

  const exec = async <
    TParams extends readonly DataType[],
    TColumns extends Record<string, DataType>,
  >({
    txCtx,
    sql: template,
    params,
  }: {
    txCtx?: TTxContext;
    sql: TypedSqlTemplate<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): Promise<InferColumns<TColumns>[]> => {
    const applied = applyTemplate(template);
    return stateProvider.executeSql({
      txCtx,
      id: applied.id,
      sql: applied.sql,
      params: params ?? [],
      paramTypes: extractParamTypes(applied.params),
      columnTypes: extractColumnTypes(applied.columns),
      readOnly: applied.readOnly,
    }) as Promise<InferColumns<TColumns>[]>;
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

    await stateProvider.withTransaction(async (txCtx) => {
      for (const statement of renameAsideStatements) {
        await exec({ txCtx, sql: sql(statement, { params: [], columns: {} }) });
      }
    });
  };

  const importLegacySchema: MigrationScript = async (assertLockHeld) => {
    const [old] = await exec({ sql: jobOldPresentSql });
    if (!old?.present) return;

    const [lastChain] = await exec({ sql: lastImportedChainSql });
    let afterChainId = lastChain?.chain_id;
    for (;;) {
      assertLockHeld();
      const batch = afterChainId
        ? await exec({ sql: nextChainBatchSql, params: [afterChainId, batchSize] })
        : await exec({ sql: firstChainBatchSql, params: [batchSize] });
      if (batch.length === 0) break;
      const chainIds = batch.map((row) => row.id);
      await stateProvider.withTransaction(async (txCtx) => {
        await exec({ txCtx, sql: importChainsSql, params: [chainIds] });
      });
      afterChainId = chainIds[chainIds.length - 1];
    }

    const [lastBlocker] = await exec({ sql: lastImportedBlockerSql });
    let afterJobId = lastBlocker?.job_id;
    for (;;) {
      assertLockHeld();
      const batch = afterJobId
        ? await exec({ sql: nextBlockerBatchSql, params: [afterJobId, batchSize] })
        : await exec({ sql: firstBlockerBatchSql, params: [batchSize] });
      if (batch.length === 0) break;
      const jobIds = batch.map((row) => row.job_id);
      await stateProvider.withTransaction(async (txCtx) => {
        await exec({ txCtx, sql: importBlockersSql, params: [jobIds] });
      });
      afterJobId = jobIds[jobIds.length - 1];
    }

    const [counts] = await exec({ sql: importedCountsSql });
    if (counts.jobs !== counts.old_jobs || counts.blockers !== counts.old_blockers) {
      throw new Error(
        `Upgrade import is incomplete: imported ${counts.jobs}/${counts.old_jobs} jobs and ${counts.blockers}/${counts.old_blockers} blockers. The renamed-aside tables were left in place.`,
      );
    }

    await stateProvider.withTransaction(async (txCtx) => {
      for (const statement of dropOldStatements) {
        await exec({ txCtx, sql: sql(statement, { params: [], columns: {} }) });
      }
    });
  };

  return { renameLegacySchemaAside, importLegacySchema };
};
