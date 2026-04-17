import { createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { type DrizzlePgContext, createDrizzlePgStateProvider } from "./provider.js";

test("state-postgres-drizzle provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const container = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
    const pool = new Pool({ connectionString: container.getConnectionUri(), idleTimeoutMillis: 0 });
    const db = drizzle(pool, { schema: {} });

    const stateProvider = createDrizzlePgStateProvider({ db });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      poisonTransaction: async (txCtx: DrizzlePgContext<Record<string, never>>) => {
        const client = (txCtx.tx as any).session.client;
        await client.query("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
      },
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await pool.end();
        await container.stop();
      },
    };
  });
}, 300_000);
