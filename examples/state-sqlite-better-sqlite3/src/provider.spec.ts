import { createAsyncRwLock } from "@queuert/sqlite";
import {
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createBetterSqlite3StateProvider } from "./provider.ts";

// #region conformance
describe("state-sqlite-better-sqlite3 provider conformance", () => {
  const db = new Database(":memory:");
  const lock = createAsyncRwLock();
  let context: SqliteStateProviderConformanceContext;

  beforeAll(async () => {
    context = await createSqliteStateProviderConformanceContext({
      createStateProvider: async () => createBetterSqlite3StateProvider({ db, lock }),
      withNonTransactionContext: async (fn) => fn({ db }),
    });
  });

  afterAll(async () => {
    db.close();
  });

  for (const conformanceCase of sqliteStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
