import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, test } from "bun:test";

import {
  createSqliteMigratorConformanceCases,
  createSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";

import { createBunSqliteStateProvider } from "./provider.ts";

// #region conformance
describe("sqlite/state-bun-sqlite provider conformance", () => {
  const db = new Database(":memory:");
  const cases = createSqliteStateProviderConformanceCases({
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
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("sqlite/state-bun-sqlite migrator conformance", () => {
  const db = new Database(":memory:");
  const cases = createSqliteMigratorConformanceCases({
    mode: "sync",
    createStateProvider: () => createBunSqliteStateProvider({ db }),
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
