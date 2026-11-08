import { runPgStateProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { test } from "vitest";

import { createPgPoolStateProvider } from "./provider.ts";

// #region conformance
test("state-postgres-pg provider passes state provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgStateProviderConformance(async () => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });

    const stateProvider = createPgPoolStateProvider({ pool });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => {
        const poolClient = await pool.connect();
        try {
          return await fn({ poolClient });
        } finally {
          poolClient.release();
        }
      },
      dispose: async () => {
        await pool.end();
      },
    };
  });
}, 60_000);
// #endregion
