import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createAsyncRwLock } from "@queuert/sqlite";
import {
  runSqliteStateProviderConformance,
  type SqliteStateProviderConformanceFixture,
} from "@queuert/sqlite/conformance";

import { createNodeSqliteStateProvider } from "./provider.ts";

// The suite from provider.spec.ts under Node's built-in test runner: `pnpm test:node`.
// #region conformance
const createFixture = async (): Promise<SqliteStateProviderConformanceFixture> => {
  const db = new DatabaseSync(":memory:");

  const lock = createAsyncRwLock();
  const stateProvider = createNodeSqliteStateProvider({ db, lock });

  return {
    stateProvider,
    withNonTransactionContext: async (fn) => fn({ db }),
    dispose: async () => {
      db.close();
    },
  };
};

await test("provider passes state provider conformance", { timeout: 30_000 }, async (t) => {
  await runSqliteStateProviderConformance(createFixture, {
    onResult: (result) => {
      t.diagnostic(`${result.status} ${result.name}`);
    },
  });
});
// #endregion
