import { test } from "bun:test";

import { runPgNotifyProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { SQL } from "bun";

import { createBunSqlNotifyProvider } from "./provider.ts";

// #region conformance
test("notify-postgres-bun-sql provider passes notify provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgNotifyProviderConformance(async () => {
    const sql = new SQL(pg.connectionString, { max: 10 });

    const notifyProvider = createBunSqlNotifyProvider({ sql });

    return {
      notifyProvider,
      dispose: async () => {
        await sql.close();
      },
    };
  });
}, 120_000);
// #endregion
