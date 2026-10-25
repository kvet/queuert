import { DatabaseSync } from "node:sqlite";

import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { describe, it } from "vitest";

import { createSyncSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createNodeSqliteSyncProvider } from "../state-provider/state-provider.node-sqlite.js";

it("index");

describe("SQLite State Adapter Conformance (node-sqlite, sync mode)", () => {
  const conformanceIt = it.extend<{
    db: DatabaseSync;
    stateAdapter: StateAdapter<{ $test: true }, string, "sync">;
    transactionConcurrency: "concurrent" | "serialized";
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new DatabaseSync(":memory:");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    transactionConcurrency: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use("serialized");
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const adapter = createSyncSqliteStateAdapter({
          stateProvider: createNodeSqliteSyncProvider({ db }),
        });
        adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string, "sync">);
      },
      { scope: "test" },
    ],
    withNonTransactionContext: [
      async ({ db }, use) => {
        await use(async (fn) => fn({ db } as unknown as { $test: true }));
      },
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});
