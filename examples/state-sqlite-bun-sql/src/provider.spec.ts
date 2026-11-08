import { test } from "bun:test";

import { createAsyncRwLock } from "@queuert/sqlite";
import { runSqliteStateProviderConformance } from "@queuert/sqlite/conformance";
import { SQL } from "bun";

import { createBunSqlSqliteStateProvider } from "./provider.ts";

// #region conformance
test("state-sqlite-bun-sql provider passes state provider conformance", async () => {
  await runSqliteStateProviderConformance(async () => {
    const sql = new SQL("sqlite://:memory:");

    const lock = createAsyncRwLock();
    const stateProvider = createBunSqlSqliteStateProvider({ sql, lock });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
      dispose: async () => {
        await sql.close();
      },
    };
  });
}, 30_000);
// #endregion
