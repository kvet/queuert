import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, test } from "bun:test";

import {
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteMigratorConformanceCases,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";

import { createBunSqliteStateProvider } from "./provider.ts";

// #region conformance
describe("sqlite/state-bun-sqlite provider conformance", () => {
  const db = new Database(":memory:");
  let context: SqliteStateProviderConformanceContext;

  beforeAll(() => {
    context = createSqliteStateProviderConformanceContext({
      createStateProvider: () => createBunSqliteStateProvider({ db }),
      withNonTransactionContext: (fn) => fn({ db }),
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

describe("sqlite/state-bun-sqlite migrator conformance", () => {
  const db = new Database(":memory:");
  const context = createSqliteMigratorConformanceContext({
    stateProvider: createBunSqliteStateProvider({ db }),
  });

  afterAll(() => {
    db.close();
  });

  for (const conformanceCase of sqliteMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
