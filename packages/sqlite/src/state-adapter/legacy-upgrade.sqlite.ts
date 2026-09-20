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

import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

type IdDataType = DataType<"string", string>;

/** @internal */
export const createLegacyUpgrade = <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
  idDataType: IdDataType,
): { renameLegacySchemaAside: MigrationScript; importLegacySchema: MigrationScript } => {
  const legacyMigrationNames = [
    "20240101000000_initial_schema",
    "20260430000000_rename_chain_indexes",
    "20260617000000_blocker_composite_pk",
  ];

  const tablePresentSql = (table: string) =>
    sql(
      /* sql */ `SELECT EXISTS(
  SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '{{table_prefix}}${table}'
) AS present`,
      {
        id: `legacy:present:${table}`,
        params: [],
        columns: { present: t.number() },
        readOnly: true,
      },
    );

  const upgradeFloor = legacyMigrationNames[legacyMigrationNames.length - 1];

  const batchSize = 1000;

  const jobOldPresentSql = tablePresentSql("job_old");
  const jobPresentSql = tablePresentSql("job");

  const legacyShapeSql = sql(
    /* sql */ `SELECT EXISTS(
SELECT 1 FROM pragma_table_info('{{table_prefix}}job') WHERE name = 'chain_type_name'
) AS present`,
    {
      id: "legacy:present:shape",
      params: [],
      columns: { present: t.number() },
      readOnly: true,
    },
  );

  const upgradeFloorAppliedSql = sql(
    /* sql */ `SELECT EXISTS(
SELECT 1 FROM {{table_prefix}}migration WHERE name = '${upgradeFloor}'
) AS present`,
    {
      id: "legacy:present:floor",
      params: [],
      columns: { present: t.number() },
      readOnly: true,
    },
  );

  const renameAsideStatements = [
    /* sql */ `ALTER TABLE {{table_prefix}}job RENAME TO {{table_prefix}}job_old`,
    /* sql */ `ALTER TABLE {{table_prefix}}job_blocker RENAME TO {{table_prefix}}job_blocker_old`,
    /* sql */ `DROP INDEX IF EXISTS {{table_prefix}}chain_index_idx`,
    /* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_deduplication_idx`,
    /* sql */ `DROP INDEX IF EXISTS {{table_prefix}}job_blocker_chain_idx`,
    /* sql */ `
CREATE UNIQUE INDEX {{table_prefix}}job_old_chain_index_idx
ON {{table_prefix}}job_old (chain_id, chain_index)`,
    /* sql */ `DELETE FROM {{table_prefix}}migration WHERE name IN (${legacyMigrationNames
      .map((name) => `'${name}'`)
      .join(", ")})`,
  ];

  const firstChainBatchSql = sql(
    /* sql */ `SELECT id FROM {{table_prefix}}job_old
WHERE chain_index = 0 ORDER BY id LIMIT ?`,
    {
      id: "legacy:chains:first",
      params: [t.number()],
      columns: { id: idDataType },
      readOnly: true,
    },
  );

  const nextChainBatchSql = sql(
    /* sql */ `SELECT id FROM {{table_prefix}}job_old
WHERE chain_index = 0 AND id > ? ORDER BY id LIMIT ?`,
    {
      id: "legacy:chains:next",
      params: [idDataType, t.number()],
      columns: { id: idDataType },
      readOnly: true,
    },
  );

  const lastImportedChainSql = sql(
    /* sql */ `SELECT chain_id FROM {{table_prefix}}job ORDER BY chain_id DESC LIMIT 1`,
    {
      id: "legacy:chains:watermark",
      params: [],
      columns: { chain_id: idDataType },
      readOnly: true,
    },
  );

  const importChainsSql = sql(
    /* sql */ `INSERT INTO {{table_prefix}}job (
id, type_name, chain_id, chain_index, continued_to_id,
input, output, status,
created_at, scheduled_at, completed_at, completed_by,
attempt, last_attempt_at, last_attempt_error,
attempt_at, attempt_by, attempt_until,
chain_status, chain_completed_at, chain_deduplication_key, chain_trace_context, trace_context)
SELECT o.id, o.type_name, o.chain_id, o.chain_index, n.id,
o.input, o.output, o.status,
o.created_at, o.scheduled_at, o.completed_at, o.completed_by,
o.attempt, o.last_attempt_at, o.last_attempt_error,
CASE WHEN o.status = 'running' THEN datetime('now', 'subsec') END,
CASE WHEN o.status = 'running' THEN COALESCE(o.leased_by, 'migrated') ELSE o.leased_by END,
CASE WHEN o.status = 'running' THEN COALESCE(o.leased_until, datetime('now', 'subsec')) ELSE o.leased_until END,
CASE WHEN o.chain_index = 0
  THEN CASE WHEN MAX(CASE WHEN n.id IS NULL THEN o.completed_at END) OVER (PARTITION BY o.chain_id) IS NULL
    THEN 'running' ELSE 'completed' END
END,
CASE WHEN o.chain_index = 0
  THEN MAX(CASE WHEN n.id IS NULL THEN o.completed_at END) OVER (PARTITION BY o.chain_id)
END,
CASE WHEN o.chain_index = 0 THEN o.deduplication_key END,
CASE WHEN o.chain_index = 0 THEN o.chain_trace_context END,
o.trace_context
FROM {{table_prefix}}job_old o
LEFT JOIN {{table_prefix}}job_old n
  ON n.chain_id = o.chain_id AND n.chain_index = o.chain_index + 1
WHERE o.chain_id IN (SELECT value FROM json_each(?))`,
    { id: "legacy:jobs:import", params: [t.string()], columns: {} },
  );

  const firstBlockerBatchSql = sql(
    /* sql */ `SELECT DISTINCT job_id FROM {{table_prefix}}job_blocker_old
ORDER BY job_id LIMIT ?`,
    {
      id: "legacy:blockers:first",
      params: [t.number()],
      columns: { job_id: idDataType },
      readOnly: true,
    },
  );

  const nextBlockerBatchSql = sql(
    /* sql */ `SELECT DISTINCT job_id FROM {{table_prefix}}job_blocker_old
WHERE job_id > ? ORDER BY job_id LIMIT ?`,
    {
      id: "legacy:blockers:next",
      params: [idDataType, t.number()],
      columns: { job_id: idDataType },
      readOnly: true,
    },
  );

  const lastImportedBlockerSql = sql(
    /* sql */ `SELECT job_id FROM {{table_prefix}}job_blocker ORDER BY job_id DESC LIMIT 1`,
    {
      id: "legacy:blockers:watermark",
      params: [],
      columns: { job_id: idDataType },
      readOnly: true,
    },
  );

  const importBlockersSql = sql(
    /* sql */ `INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT job_id, blocked_by_chain_id, "index", trace_context
FROM {{table_prefix}}job_blocker_old
WHERE job_id IN (SELECT value FROM json_each(?))`,
    { id: "legacy:blockers:import", params: [t.string()], columns: {} },
  );

  const importedCountsSql = sql(
    /* sql */ `SELECT
(SELECT count(*) FROM {{table_prefix}}job_old) AS old_jobs,
(SELECT count(*) FROM {{table_prefix}}job) AS jobs,
(SELECT count(*) FROM {{table_prefix}}job_blocker_old) AS old_blockers,
(SELECT count(*) FROM {{table_prefix}}job_blocker) AS blockers`,
    {
      id: "legacy:counts",
      params: [],
      columns: {
        old_jobs: t.number(),
        jobs: t.number(),
        old_blockers: t.number(),
        blockers: t.number(),
      },
      readOnly: true,
    },
  );

  const dropOldStatements = [
    /* sql */ `DROP TABLE {{table_prefix}}job_blocker_old`,
    /* sql */ `DROP TABLE {{table_prefix}}job_old`,
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
    if (old?.present === 1) return;
    const [job] = await exec({ sql: jobPresentSql });
    if (job?.present !== 1) return;

    const [legacyShape] = await exec({ sql: legacyShapeSql });
    const [floor] = await exec({ sql: upgradeFloorAppliedSql });
    if (legacyShape?.present !== 1) {
      if (floor?.present !== 1) return;
      throw new Error(
        `Cannot upgrade: the existing queuert job table is not in the v0.15.1 shape this upgrade reads. Restore a v0.15.1 database, or delete the database file to start fresh.`,
      );
    }
    if (floor?.present !== 1) {
      throw new Error(
        `Cannot upgrade: the existing queuert schema predates v0.15.1 (migration ${upgradeFloor} is not applied). Upgrade to @queuert/sqlite 0.15.1 and run migrateToLatest(), then upgrade to this version.`,
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
    if (old?.present !== 1) return;

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
        await exec({ txCtx, sql: importChainsSql, params: [JSON.stringify(chainIds)] });
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
        await exec({ txCtx, sql: importBlockersSql, params: [JSON.stringify(jobIds)] });
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
