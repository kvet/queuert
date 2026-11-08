import { randomUUID } from "node:crypto";

import { runDeploymentProcess } from "@queuert/helpers/testing";
import { type Migration, createMigrator, createTemplateApplier, sql } from "@queuert/typed-sql";
import Database from "better-sqlite3";

import {
  createMigrationStore,
  createSqliteStateAdapter,
  migrations,
} from "../state-adapter/state-adapter.sqlite.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

export const MARKER = "999_deployment_marker";

const newerMigration: Migration = {
  name: MARKER,
  type: "transactional",
  statements: [sql("CREATE TABLE deployment_marker (id INTEGER)")],
};

if (process.argv[1] === import.meta.filename) {
  const db = new Database(process.argv[2], { timeout: 30_000 });
  const provider = createBetterSqlite3Provider({ db });
  await createSqliteStateAdapter({ stateProvider: provider, generateJobId: () => randomUUID() });
  const store = createMigrationStore(
    provider,
    createTemplateApplier({
      table_prefix: "queuert_",
      job_id_type: "TEXT",
      worker_id_type: "TEXT",
    }),
  );
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
