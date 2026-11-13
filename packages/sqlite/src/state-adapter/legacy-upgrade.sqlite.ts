import type { Mode } from "@queuert/helpers/maybe-promise";
import { modal } from "@queuert/helpers/modal";
import { step } from "@queuert/helpers/steps";
import type { MigrationScript, MigrationStore } from "@queuert/typed-sql/migrator";
import { sql, t } from "@queuert/typed-sql/sql";
import { createTemplateExecutor, createTypedSqlExecutor } from "@queuert/typed-sql/sql-executor";
import type { TemplateApplier } from "@queuert/typed-sql/template-applier";
import type { BaseTxContext } from "queuert";
import { isSyncAdapter } from "queuert/internal";

import type { ModeSqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

const INSTALL = "001_initial_schema";
const WORKER_LIVENESS = "002_worker_liveness";

export const createLegacyUpgrade = <TTxContext extends BaseTxContext>(
  stateProvider: ModeSqliteStateProvider<TTxContext>,
  store: MigrationStore<TTxContext, Mode>,
  applyTemplate: TemplateApplier,
): MigrationScript<Mode> => {
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

  const upgrade = modal(function* (txCtx: TTxContext) {
    const applied = yield* step(store.getAppliedMigrationNames(txCtx));

    if (applied.includes(WORKER_LIVENESS)) {
      const unknown = applied.filter((name) => name !== INSTALL && name !== WORKER_LIVENESS);
      if (!applied.includes(INSTALL) || unknown.length > 0) {
        throw new Error(
          `Cannot upgrade the 0.17 schema: the migration table records ${applied.join(", ")}, but a 0.17 schema records exactly ${INSTALL} and ${WORKER_LIVENESS}.`,
        );
      }
      yield* step(execute(txCtx, createSchemaFence));
      yield* step(execute(txCtx, forgetWorkerLiveness));
      return;
    }

    if (applied.length === 1 && applied[0] === INSTALL) {
      const rows = yield* step(exec({ txCtx, sql: workerPresentSql }));
      if (rows.length === 0) {
        throw new Error(
          "Cannot upgrade a 0.16 schema directly. Upgrade it with @queuert/sqlite 0.17 first, then migrate to this version.",
        );
      }
    }
  });
  const upgradeInTransaction = isSyncAdapter(stateProvider) ? upgrade.sync : upgrade.async;

  return () => store.runInTransaction(upgradeInTransaction);
};
