import {
  type MigrationScript,
  type MigrationStore,
  type TemplateApplier,
  sql,
  t,
  createTemplateExecutor,
  createTypedSqlExecutor,
} from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

const INSTALL = "001_initial_schema";
const WORKER_LIVENESS = "002_worker_liveness";

export const createLegacyUpgrade = <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext>,
  store: MigrationStore<TTxContext>,
  applyTemplate: TemplateApplier,
): MigrationScript => {
  const workerPresentSql = applyTemplate(
    sql(
      /* sql */ `SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = '{{table_prefix}}worker'`,
      {
        id: "legacyUpgrade:workerPresent",
        params: [],
        columns: { present: t.number() },
        readOnly: true,
      },
    ),
  );
  const createSchemaFence = sql(/* sql */ `
CREATE TABLE {{table_prefix}}schema_fence_v1 (id INTEGER PRIMARY KEY)`);
  const forgetWorkerLiveness = sql(/* sql */ `
DELETE FROM {{table_prefix}}migration WHERE name = '${WORKER_LIVENESS}'`);

  const exec = createTypedSqlExecutor(stateProvider);
  const execute = createTemplateExecutor(stateProvider, applyTemplate);

  return async () => {
    await store.runInTransaction(async (txCtx) => {
      const applied = await store.getAppliedMigrationNames(txCtx);

      if (applied.includes(WORKER_LIVENESS)) {
        const unknown = applied.filter((name) => name !== INSTALL && name !== WORKER_LIVENESS);
        if (!applied.includes(INSTALL) || unknown.length > 0) {
          throw new Error(
            `Cannot upgrade the 0.17 schema: the migration table records ${applied.join(", ")}, but a 0.17 schema records exactly ${INSTALL} and ${WORKER_LIVENESS}.`,
          );
        }
        await execute(txCtx, createSchemaFence);
        await execute(txCtx, forgetWorkerLiveness);
        return;
      }

      if (applied.length === 1 && applied[0] === INSTALL) {
        const rows = await exec({ txCtx, sql: workerPresentSql });
        if (rows.length === 0) {
          throw new Error(
            "Cannot upgrade a 0.16 schema directly. Upgrade it with @queuert/sqlite 0.17 first, then migrate to this version.",
          );
        }
      }
    });
  };
};
