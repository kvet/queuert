import {
  createSqliteMigratorConformanceCases,
  createSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createBetterSqlite3StateProvider } from "./provider.ts";

// #region conformance
describe("sqlite/state-better-sqlite3 provider conformance", () => {
  const db = new Database(":memory:");
  const cases = createSqliteStateProviderConformanceCases({
    mode: "sync",
    createStateProvider: () => createBetterSqlite3StateProvider({ db }),
    withNonTransactionContext: (fn) => fn({ db }),
  });

  beforeAll(() => {});

  afterAll(async () => {
    db.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("sqlite/state-better-sqlite3 migrator conformance", () => {
  const db = new Database(":memory:");
  const cases = createSqliteMigratorConformanceCases({
    mode: "sync",
    createStateProvider: () => createBetterSqlite3StateProvider({ db }),
  });

  afterAll(async () => {
    db.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
