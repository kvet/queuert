import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";

import {
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteMigratorConformanceCases,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";

import { createNodeSqliteStateProvider } from "./provider.ts";

// #region conformance
void describe("sqlite/state-node-sqlite provider conformance", () => {
  const db = new DatabaseSync(":memory:");
  let context: SqliteStateProviderConformanceContext;

  before(() => {
    context = createSqliteStateProviderConformanceContext({
      createStateProvider: () => createNodeSqliteStateProvider({ db }),
      withNonTransactionContext: (fn) => fn({ db }),
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

void describe("sqlite/state-node-sqlite migrator conformance", () => {
  const db = new DatabaseSync(":memory:");
  const context = createSqliteMigratorConformanceContext({
    stateProvider: createNodeSqliteStateProvider({ db }),
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
