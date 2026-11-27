import { createAsyncRwLock } from "@queuert/sqlite";
import {
  createSqliteMigratorConformanceCases,
  createSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import initSqlJs from "sql.js";
import { afterAll, describe, test } from "vitest";

import { createSqlJsStateProvider } from "./provider.ts";

const SQL = await initSqlJs();

// #region conformance
describe("sqlite/state-sql-js provider conformance", () => {
  const db = new SQL.Database();
  const lock = createAsyncRwLock();
  const cases = createSqliteStateProviderConformanceCases({
    mode: "async",
    createStateProvider: async () => createSqlJsStateProvider({ db, lock }),
    withNonTransactionContext: async (fn) => fn({ db }),
  });

  afterAll(() => {
    db.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("sqlite/state-sql-js migrator conformance", () => {
  const db = new SQL.Database();
  const lock = createAsyncRwLock();
  const cases = createSqliteMigratorConformanceCases({
    mode: "async",
    createStateProvider: () => createSqlJsStateProvider({ db, lock }),
  });

  afterAll(() => {
    db.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
