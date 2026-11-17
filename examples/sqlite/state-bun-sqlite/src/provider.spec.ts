import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, test } from "bun:test";

import {
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
} from "@queuert/sqlite/conformance";

import { createBunSqliteStateProvider } from "./provider.ts";

// #region conformance
describe("sqlite/state-bun-sqlite provider conformance", () => {
  const db = new Database(":memory:");
  const { context, cases } = createSqliteStateProviderConformanceContext({
    mode: "sync",
    createStateProvider: () => createBunSqliteStateProvider({ db }),
    withNonTransactionContext: (fn) => fn({ db }),
  });

  beforeAll(() => {});

  afterAll(() => {
    db.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("sqlite/state-bun-sqlite migrator conformance", () => {
  const db = new Database(":memory:");
  const { context, cases } = createSqliteMigratorConformanceContext({
    mode: "sync",
    createStateProvider: () => createBunSqliteStateProvider({ db }),
  });

  afterAll(() => {
    db.close();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
