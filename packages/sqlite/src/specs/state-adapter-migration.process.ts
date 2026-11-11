import { randomUUID } from "node:crypto";

import { runDeploymentProcess } from "@queuert/helpers/testing";
import {
  type Migration,
  createMigrator,
  createTemplateApplier,
  createTemplateExecutor,
} from "@queuert/typed-sql";
import Database from "better-sqlite3";

import {
  createMigrationStore,
  createSchemaMigrations,
  createSqliteStateAdapter,
} from "../state-adapter/state-adapter.sqlite.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";

export const MARKER = "999_deployment_marker";

const newerMigration: Migration<BetterSqlite3Context> = {
  name: MARKER,
  up: async (txCtx) => {
    txCtx.db.exec("CREATE TABLE deployment_marker (id INTEGER)");
  },
  down: async (txCtx) => {
    txCtx.db.exec("DROP TABLE deployment_marker");
  },
};

if (process.argv[1] === import.meta.filename) {
  const db = new Database(process.argv[2], { timeout: 30_000 });
  const provider = createBetterSqlite3Provider({ db });
  createSqliteStateAdapter({ stateProvider: provider, generateJobId: () => randomUUID() });
  const applyTemplate = createTemplateApplier({
    table_prefix: "queuert_",
    migration_table: "queuert_migration",
    write_lock_table: "queuert_write_lock",
    job_id_type: "TEXT",
    worker_id_type: "TEXT",
  });
  const store = createMigrationStore(provider, applyTemplate);
  const migrations = createSchemaMigrations(createTemplateExecutor(provider, applyTemplate));
  await runDeploymentProcess({
    migrate: async ({ version, pause }) => {
      const recordMigration = store.recordMigration;
      store.recordMigration = async (txCtx, name) => {
        await pause("inside-migration");
        await recordMigration(txCtx, name);
      };
      return createMigrator({
        migrations: version === "newer" ? [...migrations, newerMigration] : migrations,
        store,
        before: async () => pause("before-migrating"),
      }).migrateToLatest();
    },
    close: () => {
      db.close();
    },
  });
}
