import { test } from "bun:test";

import { createAsyncRwLock, createAsyncSqliteStateAdapter } from "@queuert/sqlite";
import { SQL } from "bun";
import { runStateAdapterConformance } from "queuert/conformance";

import { createBunSqlSqliteStateProvider } from "./provider.js";

test("state-sqlite-bun-sql provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const sql = new SQL("sqlite://:memory:");

    const lock = createAsyncRwLock();
    const stateProvider = createBunSqlSqliteStateProvider({ sql, lock });
    const adapter = createAsyncSqliteStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      transactionConcurrency: "serialized",
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await sql.close();
      },
    };
  });
}, 30_000);
