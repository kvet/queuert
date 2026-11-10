import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, test } from "bun:test";

import { createAsyncRwLock } from "@queuert/sqlite";
import {
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";

import { createBunSqliteStateProvider } from "./provider.ts";

// #region conformance
describe("state-sqlite-bun-sqlite provider conformance", () => {
  const db = new Database(":memory:");
  const lock = createAsyncRwLock();
  let context: SqliteStateProviderConformanceContext;

  beforeAll(async () => {
    context = await createSqliteStateProviderConformanceContext({
      createStateProvider: async () => createBunSqliteStateProvider({ db, lock }),
      withNonTransactionContext: async (fn) => fn({ db }),
    });
  });

  afterAll(() => {
    db.close();
  });

  for (const conformanceCase of sqliteStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
