import { afterAll, beforeAll, describe, test } from "bun:test";

import { createAsyncRwLock } from "@queuert/sqlite";
import {
  createSqliteMigratorConformanceCases,
  createSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import { SQL } from "bun";

import { createBunSqlSqliteStateProvider } from "./provider.ts";

// #region conformance
describe("sqlite/state-bun-sql provider conformance", () => {
  const sql = new SQL("sqlite://:memory:");
  const lock = createAsyncRwLock();
  const cases = createSqliteStateProviderConformanceCases({
    mode: "async",
    createStateProvider: async () => createBunSqlSqliteStateProvider({ sql, lock }),
    withNonTransactionContext: async (fn) => fn({ txSql: sql }),
  });

  beforeAll(async () => {});

  afterAll(async () => {
    await sql.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("sqlite/state-bun-sql migrator conformance", () => {
  const sql = new SQL("sqlite://:memory:");
  const cases = createSqliteMigratorConformanceCases({
    mode: "async",
    createStateProvider: () => createBunSqlSqliteStateProvider({ sql, lock: createAsyncRwLock() }),
  });

  afterAll(async () => {
    await sql.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
