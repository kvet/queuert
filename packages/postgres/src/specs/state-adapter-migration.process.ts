import { runDeploymentProcess } from "@queuert/helpers/testing";
import { type Migration, createMigrator, createTemplateApplier, sql } from "@queuert/typed-sql";
import { Pool } from "pg";

import { createMigrationStore, migrations } from "../state-adapter/state-adapter.pg.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

export const MARKER = "999_deployment_marker";

const newerMigration: Migration = {
  name: MARKER,
  type: "transactional",
  statements: [sql("CREATE TABLE deployment_marker (id integer)")],
};

export const LEASE_TTL_MS = 2_000;

if (process.argv[1] === import.meta.filename) {
  const pool = new Pool({ connectionString: process.argv[2] });
  const store = createMigrationStore(
    createPgPoolProvider({ pool }),
    createTemplateApplier({
      schema: "public",
      table_prefix: "queuert_",
      job_id_type: "text",
      worker_id_type: "text",
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
        lock: { ttlMs: LEASE_TTL_MS, heartbeatIntervalMs: 200, pollIntervalMs: 50 },
        before: async () => pause("before-migrating"),
      }).migrateToLatest();
    },
    close: async () => pool.end(),
  });
}
