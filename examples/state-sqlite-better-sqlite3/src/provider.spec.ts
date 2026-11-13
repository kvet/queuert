import {
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  syncSqliteMigratorConformanceCases,
  syncSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createBetterSqlite3StateProvider } from "./provider.ts";

// #region conformance
describe("state-sqlite-better-sqlite3 provider conformance", () => {
  const db = new Database(":memory:");
  let context: SqliteStateProviderConformanceContext;

  beforeAll(() => {
    context = createSqliteStateProviderConformanceContext({
      createStateProvider: () => createBetterSqlite3StateProvider({ db }),
      withNonTransactionContext: (fn) => fn({ db }),
    });
  });

  afterAll(async () => {
    db.close();
  });

  for (const conformanceCase of syncSqliteStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("state-sqlite-better-sqlite3 migrator conformance", () => {
  const db = new Database(":memory:");
  const context = createSqliteMigratorConformanceContext({
    stateProvider: createBetterSqlite3StateProvider({ db }),
  });

  afterAll(async () => {
    db.close();
  });

  for (const conformanceCase of syncSqliteMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
