import { Database } from "bun:sqlite";
import { test } from "bun:test";

import { createAsyncRwLock } from "@queuert/sqlite";
import { runSqliteStateProviderConformance } from "@queuert/sqlite/conformance";

import { createBunSqliteStateProvider } from "./provider.ts";

// #region conformance
test("state-sqlite-bun-sqlite provider passes state provider conformance", async () => {
  await runSqliteStateProviderConformance(async () => {
    const db = new Database(":memory:");

    const lock = createAsyncRwLock();
    const stateProvider = createBunSqliteStateProvider({ db, lock });

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
