import Database from "better-sqlite3";
import { type StateAdapter } from "queuert";
import { stateAdapterConformanceTestSuite } from "queuert/testing";
import { describe, it } from "vitest";

import { createSyncSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createBetterSqlite3SyncProvider } from "../state-provider/state-provider.better-sqlite3.js";

it("index");

describe("SQLite State Adapter Conformance (better-sqlite3, sync mode)", () => {
  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string, "sync">;
    transactionConcurrency: "concurrent" | "serialized";
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
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
          stateProvider: createBetterSqlite3SyncProvider({ db }),
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
