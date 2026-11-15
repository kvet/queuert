import {
  type MigrationScript,
  type MigrationStore,
  type TemplateApplier,
  createTypedSqlExecutor,
  sql,
} from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

const INSTALL = "001_initial_schema";
const WORKER_LIVENESS = "002_worker_liveness";

export const LEGACY_MIGRATION_NAMES: readonly string[] = [INSTALL, WORKER_LIVENESS];

export const createLegacyUpgrade = <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  store: MigrationStore<TTxContext>,
  applyTemplate: TemplateApplier,
  schemaMigrationName: string,
): MigrationScript => {
  const createSchemaFenceSql = applyTemplate(
    sql(/* sql */ `
CREATE TABLE {{schema}}.{{table_prefix}}schema_fence_v1 (id integer PRIMARY KEY)`),
  );

  const exec = createTypedSqlExecutor(stateProvider);

  return async () => {
    await store.runInTransaction(async (txCtx) => {
      const applied = await store.getAppliedMigrationNames(txCtx);
      if (!applied.includes(INSTALL) || applied.includes(schemaMigrationName)) {
        return;
      }

      if (!applied.includes(WORKER_LIVENESS)) {
        throw new Error(
          "Cannot upgrade a 0.16 schema directly. Upgrade it with @queuert/postgres 0.17 first, then migrate to this version.",
        );
      }
      if (applied.some((name) => !LEGACY_MIGRATION_NAMES.includes(name))) {
        throw new Error(
          `Cannot upgrade the 0.17 schema: the migration table records ${applied.join(", ")}, but a 0.17 schema records exactly ${INSTALL} and ${WORKER_LIVENESS}.`,
        );
      }

      await exec({ txCtx, sql: createSchemaFenceSql });
      await store.recordMigration(txCtx, schemaMigrationName);
    });
  };
};
