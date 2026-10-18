import { test } from "bun:test";

import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { SQL } from "bun";
import { runStateAdapterConformance } from "queuert/conformance";

import { type BunSqlContext, createBunSqlStateProvider } from "./provider.js";

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
      poisonTransaction: async (txCtx: BunSqlContext) => {
        await txCtx.txSql.unsafe("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
      },
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await sql.close();
      },
    };
  });
}, 120_000);
