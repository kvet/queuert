import { runDeploymentProcess } from "@queuert/helpers/testing";
import { type Migration, createMigrator } from "@queuert/typed-sql/migrator";
import { createTemplateExecutor } from "@queuert/typed-sql/sql-executor";
import { createTemplateApplier } from "@queuert/typed-sql/template-applier";
import { Pool } from "pg";

import { createMigrationStore, createSchemaMigrations } from "../state-adapter/state-adapter.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";

export const MARKER = "999_deployment_marker";

const newerMigration: Migration<PgPoolContext> = {
  name: MARKER,
  up: async (txCtx) => {
    await txCtx.poolClient.query("CREATE TABLE deployment_marker (id integer)");
  },
  down: async (txCtx) => {
    await txCtx.poolClient.query("DROP TABLE deployment_marker");
  },
};

export const LEASE_TTL_MS = 2_000;

if (process.argv[1] === import.meta.filename) {
  const pool = new Pool({ connectionString: process.argv[2] });
  const provider = createPgPoolProvider({ pool });
  const applyTemplate = createTemplateApplier({
    schema: "public",
    table_prefix: "queuert_",
    job_id_type: "text",
    worker_id_type: "text",
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
        lock: { ttlMs: LEASE_TTL_MS, heartbeatIntervalMs: 200, pollIntervalMs: 50 },
        before: async () => pause("before-migrating"),
      }).migrateToLatest();
    },
    close: async () => pool.end(),
  });
}
