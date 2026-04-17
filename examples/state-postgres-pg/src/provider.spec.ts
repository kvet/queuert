import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { type PgPoolContext, createPgPoolStateProvider } from "./provider.js";

test("state-postgres-pg provider passes state adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runStateAdapterConformance(async () => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });

    const stateProvider = createPgPoolStateProvider({ pool });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      poisonTransaction: async (txCtx: PgPoolContext) => {
        await txCtx.poolClient.query("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
      },
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await pool.end();
      },
    };
  });
}, 60_000);
