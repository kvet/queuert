import { syncAsync, type Mode, step } from "@queuert/sync-async";
import {
  type MigrationScript,
  type MigrationStore,
  type TemplateApplier,
  createTypedSqlExecutor,
  sql,
} from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

const INSTALL = "001_initial_schema";
const WORKER_LIVENESS = "002_worker_liveness";

export const LEGACY_MIGRATION_NAMES: readonly string[] = [INSTALL, WORKER_LIVENESS];

export const createLegacyUpgrade = <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext, Mode>,
  store: MigrationStore<TTxContext, Mode>,
  applyTemplate: TemplateApplier,
  schemaMigrationName: string,
): MigrationScript<Mode> => {
  const createSchemaFenceSql = applyTemplate(
    sql(/* sql */ `
CREATE TABLE {{table_prefix}}schema_fence_v1 (id INTEGER PRIMARY KEY)`),
  );

  const exec = createTypedSqlExecutor(stateProvider);

  const upgrade = syncAsync(function* (txCtx: TTxContext) {
    const applied = yield* step(store.getAppliedMigrationNames(txCtx));
    if (!applied.includes(INSTALL) || applied.includes(schemaMigrationName)) {
      return;
    }

    if (!applied.includes(WORKER_LIVENESS)) {
      throw new Error(
        "Cannot upgrade a 0.16 schema directly. Upgrade it with @queuert/sqlite 0.17 first, then migrate to this version.",
      );
    }
    if (applied.some((name) => !LEGACY_MIGRATION_NAMES.includes(name))) {
      throw new Error(
        `Cannot upgrade the 0.17 schema: the migration table records ${applied.join(", ")}, but a 0.17 schema records exactly ${INSTALL} and ${WORKER_LIVENESS}.`,
      );
    }

    yield* step(exec({ txCtx, sql: createSchemaFenceSql }));
    yield* step(store.recordMigration(txCtx, schemaMigrationName));
  });
  const upgradeInTransaction = stateProvider.sync === true ? upgrade.sync : upgrade.async;

  return () => store.runInTransaction(upgradeInTransaction);
};
