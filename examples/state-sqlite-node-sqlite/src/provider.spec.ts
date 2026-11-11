import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";

import { createAsyncRwLock } from "@queuert/sqlite";
import {
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteMigratorConformanceCases,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";

import { createNodeSqliteStateProvider } from "./provider.ts";

// #region conformance
void describe("state-sqlite-node-sqlite provider conformance", () => {
  const db = new DatabaseSync(":memory:");
  const lock = createAsyncRwLock();
  let context: SqliteStateProviderConformanceContext;

  before(async () => {
    context = await createSqliteStateProviderConformanceContext({
      createStateProvider: async () => createNodeSqliteStateProvider({ db, lock }),
      withNonTransactionContext: async (fn) => fn({ db }),
    });
  });

  after(() => {
    db.close();
  });

  for (const conformanceCase of sqliteStateProviderConformanceCases) {
    void test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

void describe("state-sqlite-node-sqlite migrator conformance", () => {
  const db = new DatabaseSync(":memory:");
  const context = createSqliteMigratorConformanceContext({
    stateProvider: createNodeSqliteStateProvider({ db, lock: createAsyncRwLock() }),
  });

  after(() => {
    db.close();
  });

  for (const conformanceCase of sqliteMigratorConformanceCases) {
    void test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
