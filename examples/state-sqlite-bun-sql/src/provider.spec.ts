import { afterAll, beforeAll, describe, test } from "bun:test";

import { createAsyncRwLock } from "@queuert/sqlite";
import {
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import { SQL } from "bun";

import { createBunSqlSqliteStateProvider } from "./provider.ts";

// #region conformance
describe("state-sqlite-bun-sql provider conformance", () => {
  const sql = new SQL("sqlite://:memory:");
  const lock = createAsyncRwLock();
  let context: SqliteStateProviderConformanceContext;

  beforeAll(async () => {
    context = await createSqliteStateProviderConformanceContext({
      createStateProvider: async () => createBunSqlSqliteStateProvider({ sql, lock }),
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
    });
  });

  afterAll(async () => {
    await sql.close();
  });

  for (const conformanceCase of sqliteStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
