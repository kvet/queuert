import { runPgStateProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test } from "vitest";

import { createDrizzlePgStateProvider } from "./provider.ts";

// #region conformance
test("state-postgres-drizzle provider passes state provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgStateProviderConformance(async () => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    const db = drizzle(pool, { schema: {} });

    const stateProvider = createDrizzlePgStateProvider({ db });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ tx: db }),
      dispose: async () => {
        await pool.end();
      },
    };
  });
}, 60_000);
// #endregion
