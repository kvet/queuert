import { randomUUID } from "node:crypto";

import { runDeploymentProcess } from "@queuert/helpers/testing";
import type { Mode } from "@queuert/sync-async";
import {
  type Migration,
  createMigrator,
  createTemplateApplier,
  createTypedSqlExecutor,
} from "@queuert/typed-sql";
import Database from "better-sqlite3";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import {
  createMigrationStore,
  createSchemaMigrations,
} from "../state-adapter/state-schema.migrations.sqlite.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";

export const MARKER = "999_deployment_marker";

const newerMigration: Migration<BetterSqlite3Context, Mode> = {
  name: MARKER,
  up: (txCtx) => {
    txCtx.db.exec("CREATE TABLE deployment_marker (id INTEGER)");
  },
  down: (txCtx) => {
    txCtx.db.exec("DROP TABLE deployment_marker");
  },
};

if (process.argv[1] === import.meta.filename) {
  const mode = process.argv[5] as Mode;
  const db = new Database(process.argv[2], { timeout: 30_000 });
  const provider = createBetterSqlite3Provider({ db, mode });
  createSqliteStateAdapter({ stateProvider: provider, generateJobId: () => randomUUID() });
  const applyTemplate = createTemplateApplier({
    table_prefix: "queuert_",
    migration_table: "queuert_migration",
    write_lock_table: "queuert_write_lock",
    job_id_type: "TEXT",
    worker_id_type: "TEXT",
  });
  const store = createMigrationStore(provider, applyTemplate);
  const exec = createTypedSqlExecutor(provider);
  const migrations = createSchemaMigrations(
    (txCtx: BetterSqlite3Context, statement) => exec({ txCtx, sql: applyTemplate(statement) }),
    mode,
  );
  await runDeploymentProcess({
    migrate: async ({ version, pause }) => {
      // A synchronous migration cannot wait for the parent, so only the async mode pauses inside it.
      if (mode === "async") {
        const recordMigration = store.recordMigration;
        store.recordMigration = async (txCtx, name) => {
          await pause("inside-migration");
          await recordMigration(txCtx, name);
        };
      }
      return createMigrator({
        mode,
        migrations: version === "newer" ? [...migrations, newerMigration] : migrations,
        store,
      }).migrateToLatest();
    },
    close: () => {
      db.close();
    },
  });
}
