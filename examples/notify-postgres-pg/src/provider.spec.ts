import { runPgNotifyProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { test } from "vitest";

import { createPgPoolNotifyProvider } from "./provider.ts";

// #region conformance
test("notify-postgres-pg provider passes notify provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgNotifyProviderConformance(async () => {
    const pool = new Pool({ connectionString: pg.connectionString, max: 10 });
    const notifyProvider = createPgPoolNotifyProvider({ pool });

    return {
      notifyProvider,
      dispose: async () => {
        await notifyProvider.close?.();
        await pool.end();
      },
    };
  });
}, 60_000);
// #endregion
