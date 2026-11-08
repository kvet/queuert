import { test } from "bun:test";

import { runPgStateProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { SQL } from "bun";

import { createBunSqlStateProvider } from "./provider.ts";

// #region conformance
test("state-postgres-bun-sql provider passes state provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgStateProviderConformance(async () => {
    const sql = new SQL(pg.connectionString, { max: 10 });

    const stateProvider = createBunSqlStateProvider({ sql });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
      dispose: async () => {
        await sql.close();
      },
    };
  });
}, 120_000);
// #endregion
