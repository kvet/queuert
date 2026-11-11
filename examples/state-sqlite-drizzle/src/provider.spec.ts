import { createAsyncRwLock } from "@queuert/sqlite";
import {
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteMigratorConformanceCases,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createDrizzleSqliteStateProvider } from "./provider.ts";

// #region conformance
describe("state-sqlite-drizzle provider conformance", () => {
  const db = new Database(":memory:");
  const lock = createAsyncRwLock();
  let context: SqliteStateProviderConformanceContext;

  beforeAll(async () => {
    context = await createSqliteStateProviderConformanceContext({
      createStateProvider: async () => createDrizzleSqliteStateProvider({ db, lock }),
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

describe("state-sqlite-drizzle migrator conformance", () => {
  const db = new Database(":memory:");
  const context = createSqliteMigratorConformanceContext({
    stateProvider: createDrizzleSqliteStateProvider({ db, lock: createAsyncRwLock() }),
  });

  afterAll(async () => {
    db.close();
  });

  for (const conformanceCase of sqliteMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
