import { test } from "bun:test";

import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { SQL } from "bun";
import { runStateAdapterConformance } from "queuert/conformance";

import { createBunSqlStateProvider } from "./provider.js";

test("state-postgres-bun-sql provider passes state adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runStateAdapterConformance(async () => {
    const sql = new SQL(pg.connectionString, { max: 10 });

    const stateProvider = createBunSqlStateProvider({ sql });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      transactionConcurrency: "concurrent",
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await sql.close();
      },
    };
  });
}, 120_000);
