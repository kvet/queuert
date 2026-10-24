import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createDrizzlePgStateProvider } from "./provider.js";

test("state-postgres-drizzle provider passes state adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runStateAdapterConformance(async () => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    const db = drizzle(pool, { schema: {} });

    const stateProvider = createDrizzlePgStateProvider({ db });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      transactionConcurrency: "concurrent",
      withNonTransactionContext: async (fn) => fn({ tx: db }),
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await pool.end();
      },
    };
  });
}, 60_000);
