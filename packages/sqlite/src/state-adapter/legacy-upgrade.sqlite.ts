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

  // The columns the import reads, plus the absence of one the current schema added.
  const legacyColumns = [
    "chain_type_name",
    "status",
    "leased_by",
    "leased_until",
    "deduplication_key",
    "chain_trace_context",
  ];
  const legacyShapeSql = sql(
    /* sql */ `SELECT (
  (SELECT count(*) FROM pragma_table_info('{{table_prefix}}job')
    WHERE name IN (${legacyColumns.map((name) => `'${name}'`).join(", ")})) = ${legacyColumns.length}
  AND NOT EXISTS(
    SELECT 1 FROM pragma_table_info('{{table_prefix}}job') WHERE name = 'continued_to_id')
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

  const unknownMigrationsSql = sql(
    /* sql */ `SELECT name FROM {{table_prefix}}migration
WHERE name NOT IN (${legacyMigrationNames.map((name) => `'${name}'`).join(", ")})
ORDER BY name`,
    {
      id: "legacy:unknown-migrations",
      params: [],
      columns: { name: t.string() },
      readOnly: true,
    },
  );

  // `withTransaction` opens a deferred transaction, which a concurrent migrator can make fail with
  // SQLITE_BUSY when it later upgrades from a read to a write. A no-op write as the first statement
  // takes the write lock up front (waiting on busy_timeout), so every check that follows sees
  // state no other connection can change before commit.
  const acquireWriteLockSql = sql(
    /* sql */ `UPDATE {{table_prefix}}migration SET name = name WHERE 0`,
    { id: "legacy:lock", params: [], columns: {} },
  );

  const renameAsideStatements = [
    /* sql */ `ALTER TABLE {{table_prefix}}job RENAME TO {{table_prefix}}job_old`,
    /* sql */ `ALTER TABLE {{table_prefix}}job_blocker RENAME TO {{table_prefix}}job_blocker_old`,
  ];

  // Legacy indexes follow their table on rename and may share a name with one the install creates
  // with IF NOT EXISTS, which would then silently skip it; drop them all.
  const renamedAsideIndexesSql = sql(
    /* sql */ `SELECT name FROM sqlite_master
WHERE type = 'index' AND sql IS NOT NULL
  AND tbl_name IN ('{{table_prefix}}job_old', '{{table_prefix}}job_blocker_old')`,
    {
      id: "legacy:renamed-aside-indexes",
      params: [],
      columns: { name: t.string() },
      readOnly: true,
    },
  );

  const prepareImportStatements = [
    /* sql */ `
CREATE UNIQUE INDEX {{table_prefix}}job_old_chain_index_idx
ON {{table_prefix}}job_old (chain_id, chain_index)`,
    /* sql */ `DELETE FROM {{table_prefix}}migration WHERE name IN (${legacyMigrationNames
      .map((name) => `'${name}'`)
      .join(", ")})`,
  ];

  // Chains are imported whole in one transaction, so a head present in the new table marks its
  // chain done; the anti-join makes a resumed or concurrent import skip it, and tolerates chains
  // created by the engine meanwhile. The cursor only keeps one run from rescanning its own batches.
  const firstChainBatchSql = sql(
    /* sql */ `SELECT h.id FROM {{table_prefix}}job_old h
WHERE h.chain_index = 0
  AND NOT EXISTS (SELECT 1 FROM {{table_prefix}}job j WHERE j.id = h.id)
ORDER BY h.id LIMIT ?`,
    {
      id: "legacy:chains:first",
      params: [t.number()],
      columns: { id: idDataType },
      readOnly: true,
    },
  );

  const nextChainBatchSql = sql(
    /* sql */ `SELECT h.id FROM {{table_prefix}}job_old h
WHERE h.chain_index = 0 AND h.id > ?
  AND NOT EXISTS (SELECT 1 FROM {{table_prefix}}job j WHERE j.id = h.id)
ORDER BY h.id LIMIT ?`,
    {
      id: "legacy:chains:next",
      params: [idDataType, t.number()],
      columns: { id: idDataType },
      readOnly: true,
    },
  );

  // v0.15.1 recorded no attempt start time, so a running job's attempt starts at the upgrade.
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
CASE WHEN o.status = 'running' THEN COALESCE(o.leased_by, 'migrated') END,
CASE WHEN o.status = 'running' THEN COALESCE(o.leased_until, datetime('now', 'subsec')) END,
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

  const importChainBlockersSql = sql(
    /* sql */ `INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT b.job_id, b.blocked_by_chain_id, b."index", b.trace_context
FROM {{table_prefix}}job_old o
JOIN {{table_prefix}}job_blocker_old b ON b.job_id = o.id
WHERE o.chain_id IN (SELECT value FROM json_each(?))`,
    { id: "legacy:chain-blockers:import", params: [t.string()], columns: {} },
  );

  // A blocker chain may have been imported by an earlier batch and completed by a worker since,
  // after its unblock pass found no rows for the dependents imported now; unblock them here. A
  // blocker chain not imported yet counts as complete when its legacy tail is, since its own
  // import will not re-evaluate the dependents.
  const unblockImportedJobsSql = sql(
    /* sql */ `UPDATE {{table_prefix}}job
SET status = 'pending',
  scheduled_at = MAX(scheduled_at, datetime('now', 'subsec'))
WHERE status = 'blocked'
  AND id IN (
    SELECT o.id FROM {{table_prefix}}job_old o WHERE o.chain_id IN (SELECT value FROM json_each(?))
  )
  AND EXISTS (SELECT 1 FROM {{table_prefix}}job_blocker b WHERE b.job_id = {{table_prefix}}job.id)
  AND NOT EXISTS (
    SELECT 1 FROM {{table_prefix}}job_blocker b
    LEFT JOIN {{table_prefix}}job h ON h.id = b.blocked_by_chain_id AND h.chain_index = 0
    WHERE b.job_id = {{table_prefix}}job.id
      AND CASE WHEN h.id IS NOT NULL THEN h.chain_status IS NOT 'completed'
        ELSE NOT EXISTS (
          SELECT 1 FROM {{table_prefix}}job_old t
          WHERE t.chain_id = b.blocked_by_chain_id AND t.completed_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM {{table_prefix}}job_old n
              WHERE n.chain_id = t.chain_id AND n.chain_index = t.chain_index + 1
            )
        )
      END
  )`,
    { id: "legacy:jobs:unblock", params: [t.string()], columns: {} },
  );

  // Blocker rows of an imported job arrive with its chain; what remains either belongs to a job
  // that cannot be imported (reported below) or to no job at all, which is carried over as is.
  const danglingBlockers = /* sql */ `SELECT DISTINCT b.job_id FROM {{table_prefix}}job_blocker_old b
WHERE NOT EXISTS (SELECT 1 FROM {{table_prefix}}job_old o WHERE o.id = b.job_id)
  AND NOT EXISTS (SELECT 1 FROM {{table_prefix}}job_blocker n WHERE n.job_id = b.job_id)`;

  const firstDanglingBlockerBatchSql = sql(`${danglingBlockers}\nORDER BY b.job_id LIMIT ?`, {
    id: "legacy:dangling-blockers:first",
    params: [t.number()],
    columns: { job_id: idDataType },
    readOnly: true,
  });

  const nextDanglingBlockerBatchSql = sql(
    `${danglingBlockers}\n  AND b.job_id > ?\nORDER BY b.job_id LIMIT ?`,
    {
      id: "legacy:dangling-blockers:next",
      params: [idDataType, t.number()],
      columns: { job_id: idDataType },
      readOnly: true,
    },
  );

  const importDanglingBlockersSql = sql(
    /* sql */ `INSERT INTO {{table_prefix}}job_blocker (job_id, blocked_by_chain_id, "index", trace_context)
SELECT job_id, blocked_by_chain_id, "index", trace_context
FROM {{table_prefix}}job_blocker_old
WHERE job_id IN (SELECT value FROM json_each(?))`,
    { id: "legacy:dangling-blockers:import", params: [t.string()], columns: {} },
  );

  const missingCountsSql = sql(
    /* sql */ `SELECT
(SELECT count(*) FROM {{table_prefix}}job_old o
  WHERE NOT EXISTS (SELECT 1 FROM {{table_prefix}}job j WHERE j.id = o.id)) AS missing_jobs,
(SELECT count(*) FROM {{table_prefix}}job_old) AS old_jobs,
(SELECT count(*) FROM {{table_prefix}}job_blocker_old o
  WHERE NOT EXISTS (
    SELECT 1 FROM {{table_prefix}}job_blocker n
    WHERE n.job_id = o.job_id AND n.blocked_by_chain_id = o.blocked_by_chain_id AND n."index" = o."index"
  )) AS missing_blockers,
(SELECT count(*) FROM {{table_prefix}}job_blocker_old) AS old_blockers`,
    {
      id: "legacy:missing",
      params: [],
      columns: {
        missing_jobs: t.number(),
        old_jobs: t.number(),
        missing_blockers: t.number(),
        old_blockers: t.number(),
      },
      readOnly: true,
    },
  );

  // Jobs are imported with their chain's head, so a job left behind is one whose chain has no
  // head row: a continuation orphaned by a manual edit or by writes with foreign keys off.
  const missingJobsQuery = applyTemplate(
    sql(
      /* sql */ `SELECT * FROM {{table_prefix}}job_old o WHERE NOT EXISTS (SELECT 1 FROM {{table_prefix}}job j WHERE j.id = o.id)`,
      { params: [], columns: {} },
    ),
  ).sql;
  const oldBlockerTable = applyTemplate(
    sql(/* sql */ `{{table_prefix}}job_blocker_old`, { params: [], columns: {} }),
  ).sql;

  const dropOldStatements = [
    /* sql */ `DROP TABLE IF EXISTS {{table_prefix}}job_blocker_old`,
    /* sql */ `DROP TABLE IF EXISTS {{table_prefix}}job_old`,
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

  const execStatement = async (txCtx: TTxContext, statement: string): Promise<void> => {
    await exec({ txCtx, sql: sql(statement, { params: [], columns: {} }) });
  };

  const withWriteTransaction = async <T>(fn: (txCtx: TTxContext) => Promise<T>): Promise<T> =>
    stateProvider.withTransaction(async (txCtx) => {
      await exec({ txCtx, sql: acquireWriteLockSql });
      return fn(txCtx);
    });

  const isPresent = async (
    txCtx: TTxContext,
    template: TypedSqlTemplate<readonly [], { present: DataType<"number", number> }>,
  ): Promise<boolean> => {
    const [row] = await exec({ txCtx, sql: template });
    return row?.present === 1;
  };

  const renameLegacySchemaAside: MigrationScript = async () => {
    await withWriteTransaction(async (txCtx) => {
      if (await isPresent(txCtx, jobOldPresentSql)) return;
      if (!(await isPresent(txCtx, jobPresentSql))) return;

      const legacyShape = await isPresent(txCtx, legacyShapeSql);
      const floor = await isPresent(txCtx, upgradeFloorAppliedSql);
      if (!legacyShape) {
        if (!floor) return;
        throw new Error(
          `Cannot upgrade: the existing queuert job table is not in the v0.15.1 shape this upgrade reads. Restore a v0.15.1 database, or delete the database file to start fresh.`,
        );
      }
      if (!floor) {
        throw new Error(
          `Cannot upgrade: the existing queuert schema predates v0.15.1 (migration ${upgradeFloor} is not applied). Upgrade to @queuert/sqlite 0.15.1 and run migrateToLatest(), then upgrade to this version.`,
        );
      }

      const unknownMigrations = await exec({ txCtx, sql: unknownMigrationsSql });
      if (unknownMigrations.length > 0) {
        throw new Error(
          `Cannot upgrade: the queuert migration table records migrations v0.15.1 did not ship (${unknownMigrations.map((row) => row.name).join(", ")}), so the schema may not be the one this upgrade reads. Restore a v0.15.1 database, or delete the database file to start fresh.`,
        );
      }

      for (const statement of renameAsideStatements) {
        await execStatement(txCtx, statement);
      }
      for (const { name } of await exec({ txCtx, sql: renamedAsideIndexesSql })) {
        await execStatement(txCtx, `DROP INDEX "${name.replaceAll('"', '""')}"`);
      }
      for (const statement of prepareImportStatements) {
        await execStatement(txCtx, statement);
      }
    });
  };

  const importBatches = async (
    assertLockHeld: () => void,
    importBatch: (txCtx: TTxContext, afterId: string | undefined) => Promise<string | undefined>,
  ): Promise<boolean> => {
    let afterId: string | undefined;
    for (;;) {
      assertLockHeld();
      const outcome = await withWriteTransaction(
        async (txCtx): Promise<{ lastId: string | undefined } | "gone"> => {
          // A concurrent migrator may have finished the import and dropped the aside tables.
          if (!(await isPresent(txCtx, jobOldPresentSql))) return "gone";
          return { lastId: await importBatch(txCtx, afterId) };
        },
      );
      if (outcome === "gone") return false;
      if (outcome.lastId === undefined) return true;
      afterId = outcome.lastId;
    }
  };

  const importLegacySchema: MigrationScript = async (assertLockHeld) => {
    const [old] = await exec({ sql: jobOldPresentSql });
    if (old?.present !== 1) return;

    const chainsImported = await importBatches(assertLockHeld, async (txCtx, afterId) => {
      const batch = afterId
        ? await exec({ txCtx, sql: nextChainBatchSql, params: [afterId, batchSize] })
        : await exec({ txCtx, sql: firstChainBatchSql, params: [batchSize] });
      if (batch.length === 0) return undefined;
      const chainIds = JSON.stringify(batch.map((row) => row.id));
      await exec({ txCtx, sql: importChainsSql, params: [chainIds] });
      await exec({ txCtx, sql: importChainBlockersSql, params: [chainIds] });
      await exec({ txCtx, sql: unblockImportedJobsSql, params: [chainIds] });
      return batch[batch.length - 1].id;
    });
    if (!chainsImported) return;

    const danglingBlockersImported = await importBatches(assertLockHeld, async (txCtx, afterId) => {
      const batch = afterId
        ? await exec({ txCtx, sql: nextDanglingBlockerBatchSql, params: [afterId, batchSize] })
        : await exec({ txCtx, sql: firstDanglingBlockerBatchSql, params: [batchSize] });
      if (batch.length === 0) return undefined;
      const jobIds = batch.map((row) => row.job_id);
      await exec({ txCtx, sql: importDanglingBlockersSql, params: [JSON.stringify(jobIds)] });
      return jobIds[jobIds.length - 1];
    });
    if (!danglingBlockersImported) return;

    assertLockHeld();
    await withWriteTransaction(async (txCtx) => {
      if (!(await isPresent(txCtx, jobOldPresentSql))) return;
      const [missing] = await exec({ txCtx, sql: missingCountsSql });
      if (missing.missing_jobs > 0 || missing.missing_blockers > 0) {
        throw new Error(
          `Upgrade import is incomplete: ${missing.missing_jobs}/${missing.old_jobs} jobs and ${missing.missing_blockers}/${missing.old_blockers} blockers are missing from the new tables. The renamed-aside tables were left in place. Jobs are imported with their chain's head job, so a job left behind is one whose chain has no head row; list them with \`${missingJobsQuery}\`, then delete them and their ${oldBlockerTable} rows (or restore their head jobs) and run migrateToLatest() again.`,
        );
      }
      for (const statement of dropOldStatements) {
        await execStatement(txCtx, statement);
      }
    });
  };

  return { renameLegacySchemaAside, importLegacySchema };
};
