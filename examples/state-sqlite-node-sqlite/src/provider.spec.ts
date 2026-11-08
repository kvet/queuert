import { DatabaseSync } from "node:sqlite";

import { createAsyncRwLock } from "@queuert/sqlite";
import { runSqliteStateProviderConformance } from "@queuert/sqlite/conformance";
import { test } from "vitest";

import { createNodeSqliteStateProvider } from "./provider.ts";

// #region conformance
test("state-sqlite-node-sqlite provider passes state provider conformance", async () => {
  await runSqliteStateProviderConformance(async () => {
    const db = new DatabaseSync(":memory:");

    const lock = createAsyncRwLock();
    const stateProvider = createNodeSqliteStateProvider({ db, lock });

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
