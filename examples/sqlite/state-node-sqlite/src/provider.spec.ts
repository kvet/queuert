import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";

import {
  createSqliteMigratorConformanceCases,
  createSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";

import { createNodeSqliteStateProvider } from "./provider.ts";

// #region conformance
void describe("sqlite/state-node-sqlite provider conformance", () => {
  const db = new DatabaseSync(":memory:");
  const cases = createSqliteStateProviderConformanceCases({
    mode: "sync",
    createStateProvider: () => createNodeSqliteStateProvider({ db }),
    withNonTransactionContext: (fn) => fn({ db }),
  });

  before(() => {});

  after(() => {
    db.close();
  });

  for (const conformanceCase of cases) {
    void test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

void describe("sqlite/state-node-sqlite migrator conformance", () => {
  const db = new DatabaseSync(":memory:");
  const cases = createSqliteMigratorConformanceCases({
    mode: "sync",
    createStateProvider: () => createNodeSqliteStateProvider({ db }),
  });

  after(() => {
    db.close();
  });

  for (const conformanceCase of cases) {
    void test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
