import { createAsyncRwLock, createAsyncSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createDrizzleSqliteStateProvider } from "./provider.js";

test("state-sqlite-drizzle provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const db = new Database(":memory:");

    const lock = createAsyncRwLock();
    const stateProvider = createDrizzleSqliteStateProvider({ db, lock });
    const adapter = createAsyncSqliteStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      transactionConcurrency: "serialized",
      withNonTransactionContext: async (fn) => fn({ db }),
      reset: async () => adapter.truncate(),
      dispose: async () => {
        db.close();
      },
    };
  });
}, 30_000);
