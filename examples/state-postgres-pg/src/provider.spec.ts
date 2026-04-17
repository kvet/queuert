import { createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { type PgPoolContext, createPgPoolStateProvider } from "./provider.js";

test("state-postgres-pg provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const container = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
    const pool = new Pool({ connectionString: container.getConnectionUri(), idleTimeoutMillis: 0 });

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
        await container.stop();
      },
    };
  });
}, 300_000);
