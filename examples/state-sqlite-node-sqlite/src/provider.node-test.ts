import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { runStateAdapterConformance, type StateConformanceFixture } from "queuert/conformance";

import { createNodeSqliteStateProvider } from "./provider.js";

// The suite from provider.spec.ts under Node's built-in test runner: `pnpm test:node`.
// #region conformance
const createFixture = async (): Promise<StateConformanceFixture> => {
  const db = new DatabaseSync(":memory:");

  const lock = createAsyncRwLock();
  const stateProvider = createNodeSqliteStateProvider({ db, lock });
  const adapter = await createSqliteStateAdapter({ stateProvider });
  await adapter.migrateToLatest();

  return {
    stateAdapter: adapter,
    transactionConcurrency: "serialized",
    withNonTransactionContext: async (fn) => fn({ db }),
    reset: async () => adapter.truncate(),
    dispose: async () => {
      db.close();
    },
  };
};

await test("provider passes state adapter conformance", { timeout: 30_000 }, async (t) => {
  await runStateAdapterConformance(createFixture, {
    onResult: (result) => {
      t.diagnostic(`${result.status} ${result.name}`);
    },
  });
});
// #endregion
