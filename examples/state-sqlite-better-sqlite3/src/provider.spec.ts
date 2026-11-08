import { createAsyncRwLock } from "@queuert/sqlite";
import { runSqliteStateProviderConformance } from "@queuert/sqlite/conformance";
import Database from "better-sqlite3";
import { test } from "vitest";

import { createBetterSqlite3StateProvider } from "./provider.ts";

// #region conformance
test("state-sqlite-better-sqlite3 provider passes state provider conformance", async () => {
  await runSqliteStateProviderConformance(async () => {
    const db = new Database(":memory:");

    const lock = createAsyncRwLock();
    const stateProvider = createBetterSqlite3StateProvider({ db, lock });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ db }),
      dispose: async () => {
        db.close();
      },
    };
  });
}, 30_000);
// #endregion
